"""PolishLoop sandbox: runs an agent's patch against a real GitHub repo on Modal.

POST /validate {repo: "owner/name", sha, changes: {path: content}, newTests: [path]}
returns install/compile/lint/pytest results plus a fail-to-pass check (do the
new tests fail on the original code and pass with the patch?).

Safety model:
- This web endpoint is trusted and holds the auth token. It never runs repo code.
- Each validation runs in a fresh Modal Sandbox with NO secrets and outbound
  network limited to GitHub (source download) and PyPI (dependencies).
- Only public repos are supported (the sandbox downloads without credentials).

Setup (once):
    pip install modal
    modal setup
    modal secret create polishloop-sandbox SANDBOX_TOKEN=<long random string>
    modal deploy sandbox-service/modal_app.py
Put the printed URL + "/validate" in .env as SANDBOX_URL and the token as SANDBOX_TOKEN.
"""

import hmac
import json
import os
import re
import shlex
import xml.etree.ElementTree as ET

import modal

APP_NAME = "polishloop-sandbox"
REPO_DIR = "/repo"
ALLOWED_DOMAINS = ["github.com", "codeload.github.com", "pypi.org", "files.pythonhosted.org"]
INSTALL_TIMEOUT_S = 240
TEST_TIMEOUT_S = 300
MAX_FILES = 40
MAX_FILE_CHARS = 200_000
TAIL_CHARS = 2_000
LINT_RULES = "E9,F63,F7,F82,F401,F811,F841"
REQUIREMENT_FILES = ["requirements.txt", "requirements-dev.txt", "requirements_dev.txt", "dev-requirements.txt", "test-requirements.txt", "requirements-test.txt"]

app = modal.App(APP_NAME)

web_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")

sandbox_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "git")
    .pip_install("pip>=24", "setuptools", "wheel", "pytest==8.3.3", "ruff==0.6.9")
)

SAFE_PATH = re.compile(r"^(?!/)(?!.*\.\.)[A-Za-z0-9_./-]+\.py$")


def tail(text: str) -> str:
    return text[-TAIL_CHARS:]


def run(sb: "modal.Sandbox", cmd: str, timeout: int = 120) -> tuple[int, str, str]:
    try:
        p = sb.exec("bash", "-lc", cmd, timeout=timeout, workdir=REPO_DIR)
        p.wait()
        return p.returncode, p.stdout.read(), p.stderr.read()
    except Exception as exc:  # exec timeout or sandbox failure: report, don't crash the endpoint
        return 124, "", f"{type(exc).__name__}: {exc}"


def write_file(sb: "modal.Sandbox", path: str, content: str) -> None:
    full = f"{REPO_DIR}/{path}"
    parent = full.rsplit("/", 1)[0]
    sb.filesystem.make_directory(parent, create_parents=True)
    sb.filesystem.write_text(content, full)


def read_file(sb: "modal.Sandbox", path: str) -> str | None:
    try:
        return sb.filesystem.read_text(f"{REPO_DIR}/{path}")
    except Exception:
        return None


def module_of(path: str) -> str:
    return path[:-3].replace("/", ".")


def parse_junit(xml_text: str, new_test_modules: list[str]) -> dict:
    root = ET.fromstring(xml_text)
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    total = sum(int(s.get("tests", 0)) for s in suites)
    failed = sum(int(s.get("failures", 0)) for s in suites)
    errors = sum(int(s.get("errors", 0)) for s in suites)
    skipped = sum(int(s.get("skipped", 0)) for s in suites)
    failures, new_cases, new_ok = [], 0, True
    for case in root.iter("testcase"):
        bad = case.find("failure") if case.find("failure") is not None else case.find("error")
        classname = case.get("classname", "")
        if any(classname == m or classname.startswith(m + ".") for m in new_test_modules):
            new_cases += 1
            new_ok = new_ok and bad is None
        if bad is not None and len(failures) < 10:
            failures.append({"test": f"{classname}::{case.get('name', '')}", "message": (bad.get("message") or bad.text or "")[:500]})
    return {
        "total": total,
        "failed": failed,
        "errors": errors,
        "skipped": skipped,
        "passed": max(total - failed - errors - skipped, 0),
        "failures": failures,
        "new_tests_passed": new_cases > 0 and new_ok,
    }


def validate_patch(repo: str, sha: str, changes: dict[str, str], new_tests: list[str]) -> dict:
    import time

    started = time.time()
    sb_app = modal.App.lookup(APP_NAME, create_if_missing=True)
    sb = modal.Sandbox.create(
        app=sb_app,
        image=sandbox_image,
        timeout=900,
        cpu=1.0,
        memory=2048,
        outbound_domain_allowlist=ALLOWED_DOMAINS,
    )
    try:
        sb.exec("mkdir", "-p", REPO_DIR).wait()
        code, _, err = run(sb, f"curl -fsSL https://codeload.github.com/{repo}/tar.gz/{sha} | tar xz --strip-components=1 -C {REPO_DIR}")
        if code != 0:
            raise RuntimeError(f"could not download {repo}@{sha}: {tail(err)}")

        install_cmd = (
            "set -o pipefail; "
            "if [ -f pyproject.toml ] || [ -f setup.py ]; then pip install -q -e . ; fi; "
            f"for r in {' '.join(REQUIREMENT_FILES)}; do [ -f \"$r\" ] && pip install -q -r \"$r\"; done; true"
        )
        icode, iout, ierr = run(sb, install_cmd, timeout=INSTALL_TIMEOUT_S)
        install_ok = icode == 0 and "ERROR" not in ierr

        # Fail-to-pass, part 1: only the new/changed tests on the ORIGINAL code.
        fail_to_pass = None
        tests = [t for t in new_tests if t in changes]
        if tests:
            originals = {t: read_file(sb, t) for t in tests}
            for t in tests:
                write_file(sb, t, changes[t])
            bcode, _, _ = run(sb, f"python -m pytest -q -p no:cacheprovider {' '.join(shlex.quote(t) for t in tests)}", timeout=TEST_TIMEOUT_S)
            failed_on_base = bcode != 0
            for t, original in originals.items():
                if original is None:
                    run(sb, f"rm -f {shlex.quote(t)}")
                else:
                    write_file(sb, t, original)
            fail_to_pass = {"newTests": tests, "failedOnBase": failed_on_base, "passedAfter": False}

        # Apply the full patch.
        for path, content in changes.items():
            write_file(sb, path, content)
        quoted = " ".join(shlex.quote(p) for p in changes)

        ccode, _, cerr = run(sb, f"python -m py_compile {quoted}")
        compile_errors = [line for line in cerr.splitlines() if line.strip()][:10] if ccode != 0 else []

        _, lout, _ = run(sb, f"ruff check --no-cache --output-format json --select {LINT_RULES} {quoted}")
        try:
            lint = [
                {"file": i["filename"].replace(REPO_DIR + "/", ""), "line": i["location"]["row"], "code": i["code"] or "", "message": i["message"]}
                for i in json.loads(lout or "[]")
            ]
        except (ValueError, KeyError):
            lint = []

        tcode, tout, terr = run(sb, f"python -m pytest -q -p no:cacheprovider --junitxml=/tmp/junit.xml", timeout=TEST_TIMEOUT_S)
        junit_text = None
        try:
            junit_text = sb.filesystem.read_text("/tmp/junit.xml")
        except Exception:
            pass
        if junit_text:
            j = parse_junit(junit_text, [module_of(t) for t in tests])
            tests_result = {
                "ran": True,
                "total": j["total"],
                "passed": j["passed"],
                "failed": j["failed"],
                "errors": j["errors"],
                "skipped": j["skipped"],
                "failures": j["failures"],
                "outputTail": tail(tout + terr),
            }
            if fail_to_pass is not None:
                fail_to_pass["passedAfter"] = j["new_tests_passed"]
        else:
            tests_result = {"ran": False, "total": 0, "passed": 0, "failed": 0, "errors": 0, "skipped": 0, "failures": [], "outputTail": tail(tout + terr)}

        return {
            "install": {"ok": install_ok, "logTail": tail(iout + ierr)},
            "compile": {"ok": not compile_errors, "errors": compile_errors},
            "lint": {"issues": lint[:30]},
            "tests": tests_result,
            "failToPass": fail_to_pass,
            "durationMs": int((time.time() - started) * 1000),
        }
    finally:
        sb.terminate()


@app.function(image=web_image, secrets=[modal.Secret.from_name("polishloop-sandbox")], timeout=900, max_containers=4)
@modal.asgi_app()
def web():
    # Imported here so `modal deploy` works without FastAPI installed locally.
    from fastapi import Depends, FastAPI, HTTPException, status
    from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
    from pydantic import BaseModel, Field, field_validator

    class ValidateRequest(BaseModel):
        repo: str = Field(pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
        sha: str = Field(pattern=r"^[0-9a-f]{7,40}$")
        changes: dict[str, str]
        newTests: list[str] = Field(default_factory=list, max_length=MAX_FILES)

        @field_validator("changes")
        @classmethod
        def check_changes(cls, changes: dict[str, str]) -> dict[str, str]:
            if not changes or len(changes) > MAX_FILES:
                raise ValueError(f"changes must contain 1-{MAX_FILES} files")
            for path, content in changes.items():
                if not SAFE_PATH.match(path):
                    raise ValueError(f"unsafe or non-Python path: {path}")
                if len(content) > MAX_FILE_CHARS:
                    raise ValueError(f"{path} is too large")
            return changes

    api = FastAPI(title="PolishLoop sandbox", docs_url=None, redoc_url=None, openapi_url=None)
    auth_scheme = HTTPBearer()

    @api.post("/validate")
    def validate(req: ValidateRequest, token: HTTPAuthorizationCredentials = Depends(auth_scheme)) -> dict:
        if not hmac.compare_digest(token.credentials.encode(), os.environ["SANDBOX_TOKEN"].encode()):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        try:
            return validate_patch(req.repo, req.sha, req.changes, req.newTests)
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return api
