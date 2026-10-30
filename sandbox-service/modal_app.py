"""ThePolisher sandbox: runs an agent's patch against a real GitHub repo on Modal.

POST /validate {repo: "owner/name", sha, changes: {path: content}, newTests: [path]}
returns install/compile/lint/pytest results, a fail-to-pass check (do the
new tests fail on the original code and pass with the patch?) and a bandit
security scan that reports only the findings the patch introduced.

Safety model:
- This web endpoint is trusted and holds the auth token. It never runs repo code.
- Each validation runs in a fresh Modal Sandbox with NO secrets and outbound
  network limited to GitHub (source download) and PyPI (dependencies).
- Only public repos are supported (the sandbox downloads without credentials).

Dependency cache: installing a repo's dependencies is the slowest step, so the
result is cached per repo commit in the Volume "thepolisher-sandbox-deps". The
environment is packed right after installing from the ORIGINAL code, before any
patch or test runs, and this trusted function (not the sandbox) copies it out
and into the Volume. Sandboxes never mount the Volume; a later sandbox for the
same commit gets a copy unpacked into it. So agent-written code and tests can't
reach the cache another run will use.

Setup (once):
    pip install modal
    modal setup
    modal secret create thepolisher-sandbox SANDBOX_TOKEN=<long random string>
    modal deploy sandbox-service/modal_app.py
Put the printed URL + "/validate" in .env as SANDBOX_URL and the token as SANDBOX_TOKEN.
"""

import hmac
import json
import os
import re
import shlex
import xml.etree.ElementTree as ET
from typing import Literal

import modal

APP_NAME = "thepolisher-sandbox"
REPO_DIR = "/repo"
ALLOWED_DOMAINS = ["github.com", "codeload.github.com", "pypi.org", "files.pythonhosted.org"]
INSTALL_TIMEOUT_S = 240
TEST_TIMEOUT_S = 300
MAX_FILES = 40
MAX_FILE_CHARS = 200_000
TAIL_CHARS = 2_000
LINT_RULES = "E9,F63,F7,F82,F401,F811,F841"
# The repo's dependencies go into this venv; it sees the image's pytest/ruff/bandit.
VENV = "/opt/venv"
CACHE_DIR = "/cache"
# Bump when the image or the install steps change in a way old caches don't reflect.
CACHE_VERSION = "1"
MAX_CACHE_BYTES = 400_000_000
MAX_CACHE_ENTRIES = 60
PACKED = "/tmp/deps.tar.gz"
REQUIREMENT_FILES = ["requirements.txt", "requirements-dev.txt", "requirements_dev.txt", "dev-requirements.txt", "test-requirements.txt", "requirements-test.txt"]

# Runs inside the sandbox. Installs the project and whatever its tests need, and exits non-zero
# if any step failed, so a broken install is never reported as OK.
INSTALL_SCRIPT = f'''
import os, pathlib, subprocess, sys, tomllib

import re

data = tomllib.loads(pathlib.Path("pyproject.toml").read_text()) if pathlib.Path("pyproject.toml").exists() else {{}}
dist = data.get("project", {{}}).get("name") or data.get("tool", {{}}).get("poetry", {{}}).get("name") or ""

# The repo arrives as a tarball without .git; setuptools-scm / hatch-vcs need a version from somewhere.
# Newer setuptools-scm only honours the per-distribution form of the variable.
env = {{**os.environ, "SETUPTOOLS_SCM_PRETEND_VERSION": "0.0.0"}}
if dist:
    env["SETUPTOOLS_SCM_PRETEND_VERSION_FOR_" + re.sub(r"[^A-Za-z0-9]+", "_", dist).upper()] = "0.0.0"
ok = True

def pip(*args):
    return subprocess.run([sys.executable, "-m", "pip", "install", "-q", *args], env=env).returncode == 0

if pathlib.Path("pyproject.toml").exists() or pathlib.Path("setup.py").exists():
    # Test dependencies often live in a [dev] or [test] extra; pip only warns about extras a project lacks.
    ok &= pip("-e", ".[dev,test,tests]") or pip("-e", ".")
TEST_GROUPS = ("dev", "test", "tests", "testing")
# PEP 735 dependency groups (pip >= 25.1).
for name in TEST_GROUPS:
    if name in data.get("dependency-groups", {{}}):
        ok &= pip("--group", name)
# Poetry groups: install the package names; poetry's version syntax isn't pip's.
poetry = data.get("tool", {{}}).get("poetry", {{}})
names = [k for k in poetry.get("dev-dependencies", {{}}) if k != "python"]
for group, spec in poetry.get("group", {{}}).items():
    if group in TEST_GROUPS:
        names += [k for k in spec.get("dependencies", {{}}) if k != "python"]
if names:
    ok &= pip(*sorted(set(names)))

for req in {REQUIREMENT_FILES!r}:
    if pathlib.Path(req).exists():
        ok &= pip("-r", req)

sys.exit(0 if ok else 1)
'''

app = modal.App(APP_NAME)

deps_volume = modal.Volume.from_name("thepolisher-sandbox-deps", create_if_missing=True)

web_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")

sandbox_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "git")
    .pip_install("pip>=24", "setuptools", "wheel", "pytest==8.3.3", "ruff==0.6.9", "bandit==1.7.10")
)

SAFE_PATH = re.compile(r"^(?!/)(?!.*\.\.)[A-Za-z0-9_./-]+\.py$")


def tail(text: str) -> str:
    return text[-TAIL_CHARS:]


def run(sb: "modal.Sandbox", cmd: str, timeout: int = 120) -> tuple[int, str, str]:
    try:
        # The venv first, so `python` is the one with the repo's dependencies.
        p = sb.exec("bash", "-lc", f"export PATH={VENV}/bin:$PATH; {cmd}", timeout=timeout, workdir=REPO_DIR)
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


# ─── Dependency cache ─────────────────────────────────────────────────────


def cache_path(repo: str, sha: str) -> str:
    """Volume path for a repo commit's installed dependencies (a hash, so no path tricks)."""
    import hashlib

    key = hashlib.sha256(f"{CACHE_VERSION}|{repo}|{sha}|{INSTALL_SCRIPT}".encode()).hexdigest()
    return f"{CACHE_DIR}/{key}.tar.gz"


def restore_deps(sb: "modal.Sandbox", path: str) -> bool:
    """Unpack a cached environment into the sandbox. False on a miss or any problem."""
    try:
        deps_volume.reload()  # see what other containers saved
    except Exception:
        pass
    if not os.path.exists(path):
        return False
    try:
        sb.filesystem.copy_from_local(path, PACKED)
    except Exception:
        return False
    code, _, _ = run(sb, f"tar xzf {PACKED} -C / && rm -f {PACKED}", timeout=180)
    return code == 0


def install_deps(sb: "modal.Sandbox") -> tuple[bool, str]:
    """Fresh install into the venv. Notes which files the install creates in the repo
    (e.g. a generated _version.py), so a cached copy can bring them back too."""
    run(sb, "find . -type f | sort > /tmp/files_before.txt")
    run(sb, f"python -m venv --system-site-packages {VENV}")
    # A new venv's pip is the one bundled with Python; dependency groups need pip >= 25.1.
    run(sb, 'python -m pip install -q --upgrade "pip>=25.1"', timeout=INSTALL_TIMEOUT_S)
    sb.filesystem.write_text(INSTALL_SCRIPT, "/tmp/install_deps.py")
    code, out, err = run(sb, "python /tmp/install_deps.py", timeout=INSTALL_TIMEOUT_S)
    return code == 0, out + err


def save_deps(sb: "modal.Sandbox", path: str) -> None:
    """Pack the venv plus files the install created in the repo, and store them in the
    Volume. Runs before any patch or test touches the sandbox. Best effort: a failure
    here only means the next run installs again."""
    try:
        code, _, _ = run(
            sb,
            "find . -type f | sort > /tmp/files_after.txt; "
            "comm -13 /tmp/files_before.txt /tmp/files_after.txt | sed 's|^\\./|repo/|' > /tmp/created.txt; "
            f"tar czf {PACKED} -C / {VENV.lstrip('/')} -T /tmp/created.txt",
            timeout=180,
        )
        if code != 0:
            return
        size, _, _ = run(sb, f"test $(stat -c %s {PACKED}) -le {MAX_CACHE_BYTES}")
        if size != 0:
            return
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = f"{path}.partial"
        sb.filesystem.copy_to_local(PACKED, tmp)
        os.replace(tmp, path)  # another container may save the same commit; last one wins
        prune_cache()
        deps_volume.commit()
    except Exception:
        pass


def prune_cache() -> None:
    """Keep the newest MAX_CACHE_ENTRIES environments (and their base-failure lists)."""
    entries = sorted(
        (e for e in os.scandir(CACHE_DIR) if e.name.endswith(".tar.gz")),
        key=lambda e: e.stat().st_mtime,
        reverse=True,
    )
    for e in entries[MAX_CACHE_ENTRIES:]:
        os.remove(e.path)
        base = base_failures_path(e.path)
        if os.path.exists(base):
            os.remove(base)


# ─── The original code's failing tests, once per commit ───────────────────


def base_failures_path(deps_path: str) -> str:
    return deps_path.removesuffix(".tar.gz") + ".base-failures.json"


def load_base_failures(deps_path: str) -> set[str] | None:
    try:
        with open(base_failures_path(deps_path), encoding="utf-8") as f:
            return set(json.load(f))
    except Exception:
        return None


def compute_base_failures(sb: "modal.Sandbox") -> set[str] | None:
    """Run the whole suite on the ORIGINAL code. Must run before any patch or new test
    touches the sandbox, since the result is cached for every later run on this commit."""
    run(sb, "python -m pytest -q -p no:cacheprovider --junitxml=/tmp/base_full.xml", timeout=TEST_TIMEOUT_S)
    try:
        return failing_ids(sb.filesystem.read_text("/tmp/base_full.xml"))
    except Exception:
        return None  # suite didn't finish; checks fall back to re-running the original code


def save_base_failures(deps_path: str, failing: set[str]) -> None:
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        path = base_failures_path(deps_path)
        with open(f"{path}.partial", "w", encoding="utf-8") as f:
            json.dump(sorted(failing)[:MAX_FAILURES_KEPT], f)
        os.replace(f"{path}.partial", path)
        deps_volume.commit()
    except Exception:
        pass


# ─── Targeted tests ───────────────────────────────────────────────────────

MAX_TARGET_FILES = 40

# Runs inside the sandbox. argv: JSON list of changed source paths, JSON list of test files
# in the patch. Prints the test files to run: those in the patch, plus existing ones named
# after or importing a changed module. Prints null when nothing related is found or the
# selection is too big to be worth it (run the whole suite then).
SELECT_TESTS_SCRIPT = f'''
import json, os, re, sys
changed, explicit = json.loads(sys.argv[1]), json.loads(sys.argv[2])
SKIP = {{".git", "node_modules", ".venv", "venv", "build", "dist", ".tox", ".nox"}}
tests = []
for root, dirs, files in os.walk("."):
    dirs[:] = [d for d in dirs if d not in SKIP]
    for f in files:
        if f.endswith(".py") and (f.startswith("test_") or f.endswith("_test.py")):
            tests.append(os.path.relpath(os.path.join(root, f)).replace(os.sep, "/"))
mods = []
for p in changed:
    dotted = p[:-3].replace("/", ".")
    if dotted.startswith("src."):
        dotted = dotted[4:]
    if dotted.endswith(".__init__"):
        dotted = dotted[: -len(".__init__")]
    mods.append((dotted.rsplit(".", 1)[-1], dotted))
picked = set(explicit)
for t in tests:
    name = os.path.basename(t)[:-3].removeprefix("test_").removesuffix("_test")
    try:
        text = open(t, encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    for leaf, dotted in mods:
        parent = dotted.rpartition(".")[0]
        imports = re.search(
            rf"import\\s+{{re.escape(dotted)}}\\b|from\\s+{{re.escape(dotted)}}\\s+import"
            + (rf"|from\\s+{{re.escape(parent)}}\\s+import\\s[^\\n]*\\b{{re.escape(leaf)}}\\b" if parent else ""),
            text,
        )
        if leaf in name or imports:
            picked.add(t)
related = picked - set(explicit)
print(json.dumps(sorted(picked) if related and len(picked) <= {MAX_TARGET_FILES} else None))
'''


def select_tests(sb: "modal.Sandbox", sources: list[str], patch_tests: list[str]) -> list[str] | None:
    """Test files for a targeted run, or None to run the whole suite."""
    sb.filesystem.write_text(SELECT_TESTS_SCRIPT, "/tmp/select_tests.py")
    code, out, _ = run(sb, f"python /tmp/select_tests.py {shlex.quote(json.dumps(sources))} {shlex.quote(json.dumps(patch_tests))}")
    if code != 0:
        return None
    try:
        picked = json.loads(out.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return None
    return [p for p in picked if SAFE_PATH.match(p)] if isinstance(picked, list) else None


TEST_PATH = re.compile(r"(^|/)(tests?/|test_[^/]*\.py$|[^/]*_test\.py$|conftest\.py$)")
# Only findings a reviewer must act on; LOW is mostly style (asserts, subprocess imports).
SECURITY_SEVERITIES = {"MEDIUM", "HIGH"}


def bandit_scan(sb: "modal.Sandbox", paths: list[str]) -> list[dict] | None:
    """Bandit findings in the given files, or None if the scan itself failed."""
    if not paths:
        return []
    # Bandit exits 1 when it finds something, so read the JSON whatever the exit code.
    _, out, _ = run(sb, f"bandit -q -f json {' '.join(shlex.quote(p) for p in paths)}")
    try:
        results = json.loads(out or "{}").get("results", [])
    except ValueError:
        return None
    return [
        {
            "file": r["filename"].replace(REPO_DIR + "/", "").removeprefix("./"),
            "line": r["line_number"],
            "testId": r["test_id"],
            "severity": r["issue_severity"],
            "confidence": r["issue_confidence"],
            "text": r["issue_text"],
        }
        for r in results
    ]


def new_findings(before: list[dict], after: list[dict]) -> list[dict]:
    """Findings the patch introduced: line numbers shift, so match on file, rule and message."""
    remaining: dict[tuple, int] = {}
    for f in before:
        key = (f["file"], f["testId"], f["text"])
        remaining[key] = remaining.get(key, 0) + 1
    fresh = []
    for f in after:
        key = (f["file"], f["testId"], f["text"])
        if remaining.get(key, 0) > 0:
            remaining[key] -= 1
        else:
            fresh.append(f)
    return fresh


def module_of(path: str) -> str:
    return path[:-3].replace("/", ".")


# A new test that fails on the original code only because it imports or calls something
# the fix adds proves nothing about the bug.
MISSING_CODE = re.compile(
    r"\b(ImportError|ModuleNotFoundError|NameError)\b|cannot import name|module '[^']+' has no attribute|collection failure"
)


def classify_base_failures(xml_text: str) -> dict:
    """How the new tests failed on the original code: reproducing the bug, or only missing new code."""
    root = ET.fromstring(xml_text)
    reproduced, missing, example = 0, 0, ""
    for case in root.iter("testcase"):
        bad = case.find("failure") if case.find("failure") is not None else case.find("error")
        if bad is None:
            continue
        detail = f"{bad.get('message') or ''}\n{bad.text or ''}"
        if MISSING_CODE.search(detail):
            missing += 1
            # The line that names what's missing, not pytest's generic "collection failure".
            lines = [l.strip().removeprefix("E").strip() for l in detail.splitlines() if MISSING_CODE.search(l)]
            specific = [l for l in lines if l != "collection failure"]
            example = example or (specific or lines or [""])[-1][:200]
        else:
            reproduced += 1
    return {"reproduced": reproduced, "missingCode": missing, "example": example}


MAX_FAILURES_KEPT = 2000


def failing_ids(xml_text: str) -> set[str]:
    """Every failing or erroring test in a junit report, as classname::name."""
    root = ET.fromstring(xml_text)
    return {
        f"{case.get('classname', '')}::{case.get('name', '')}"
        for case in root.iter("testcase")
        if case.find("failure") is not None or case.find("error") is not None
    }


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
        if bad is not None and len(failures) < MAX_FAILURES_KEPT:
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


def validate_patch(repo: str, sha: str, changes: dict[str, str], new_tests: list[str], scope: str = "full") -> dict:
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

        # Dependencies: from the cache when this commit was installed before, else installed and
        # cached now, while the repo is still the original code (no patch, no tests run yet).
        cached = cache_path(repo, sha)
        from_cache = restore_deps(sb, cached)
        if from_cache:
            install_ok, install_log = True, "Dependencies restored from the cache for this commit."
        else:
            install_ok, install_log = install_deps(sb)
            if install_ok:
                save_deps(sb, cached)

        # The original code's failing tests: worked out once per commit while this sandbox is
        # still pristine (no patch, no new tests), then cached, so no later check re-runs the
        # whole suite just to tell old failures from new ones.
        base_failing = load_base_failures(cached)
        if base_failing is None and install_ok:
            base_failing = compute_base_failures(sb)
            if base_failing is not None:
                save_base_failures(cached, base_failing)

        # Fail-to-pass, part 1: only the new/changed tests on the ORIGINAL code.
        fail_to_pass = None
        tests = [t for t in new_tests if t in changes]
        if tests:
            originals = {t: read_file(sb, t) for t in tests}
            for t in tests:
                write_file(sb, t, changes[t])
            bcode, _, _ = run(
                sb,
                f"python -m pytest -q -p no:cacheprovider --junitxml=/tmp/base.xml {' '.join(shlex.quote(t) for t in tests)}",
                timeout=TEST_TIMEOUT_S,
            )
            failed_on_base = bcode != 0
            base_failures = None
            try:
                base_failures = classify_base_failures(sb.filesystem.read_text("/tmp/base.xml"))
            except Exception:
                pass
            for t, original in originals.items():
                if original is None:
                    run(sb, f"rm -f {shlex.quote(t)}")
                else:
                    write_file(sb, t, original)
            fail_to_pass = {"newTests": tests, "failedOnBase": failed_on_base, "passedAfter": False, "baseFailures": base_failures}

        # Security, part 1: scan the source files the patch changes, as they are now.
        sources = [p for p in changes if p.endswith(".py") and not TEST_PATH.search(p)]
        security_before = bandit_scan(sb, [p for p in sources if read_file(sb, p) is not None])

        # Kept so the original code can be re-tested if anything fails with the patch.
        originals = {path: read_file(sb, path) for path in changes}

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

        # Security, part 2: the same files after the patch; only new findings count against it.
        security_after = bandit_scan(sb, sources)
        if security_before is None or security_after is None:
            security = {"ran": False, "newIssues": []}
        else:
            fresh = [f for f in new_findings(security_before, security_after) if f["severity"] in SECURITY_SEVERITIES]
            security = {"ran": True, "newIssues": fresh[:20]}

        # Targeted: only the patch's tests and the test files for the changed modules (fast);
        # full: the whole suite. Falls back to the whole suite when nothing related is found.
        targets = select_tests(sb, sources, [p for p in changes if TEST_PATH.search(p)]) if scope == "targeted" else None
        target_args = " ".join(shlex.quote(t) for t in targets) if targets else ""
        tcode, tout, terr = run(sb, f"python -m pytest -q -p no:cacheprovider --junitxml=/tmp/junit.xml {target_args}", timeout=TEST_TIMEOUT_S)
        junit_text = None
        try:
            junit_text = sb.filesystem.read_text("/tmp/junit.xml")
        except Exception:
            pass
        if junit_text:
            j = parse_junit(junit_text, [module_of(t) for t in tests])
            # Failures that also happen on the original code (a flaky or environment-dependent test,
            # an upstream dependency change) aren't the patch's doing. Only checked when something failed.
            preexisting: list[str] = []
            if j["failures"] and base_failing is not None:
                preexisting = sorted(f["test"] for f in j["failures"] if f["test"] in base_failing)
            elif j["failures"]:
                # No cached list (the original suite didn't finish): re-run the same tests on the original code.
                for path, original in originals.items():
                    if original is None:
                        run(sb, f"rm -f {shlex.quote(path)}")
                    else:
                        write_file(sb, path, original)
                run(sb, f"python -m pytest -q -p no:cacheprovider --junitxml=/tmp/base_rerun.xml {target_args}", timeout=TEST_TIMEOUT_S)
                try:
                    on_base = failing_ids(sb.filesystem.read_text("/tmp/base_rerun.xml"))
                    preexisting = sorted(f["test"] for f in j["failures"] if f["test"] in on_base)
                except Exception:
                    preexisting = []
            fresh = [f for f in j["failures"] if f["test"] not in set(preexisting)]
            tests_result = {
                "ran": True,
                "total": j["total"],
                "passed": j["passed"],
                "failed": j["failed"],
                "errors": j["errors"],
                "skipped": j["skipped"],
                "failures": fresh[:10],
                "preexisting": preexisting[:50],
                "preexistingCount": len(preexisting),
                "outputTail": tail(tout + terr),
                "scope": "targeted" if targets else "full",
                "selectedFiles": len(targets) if targets else None,
            }
            if fail_to_pass is not None:
                fail_to_pass["passedAfter"] = j["new_tests_passed"]
        else:
            tests_result = {"ran": False, "total": 0, "passed": 0, "failed": 0, "errors": 0, "skipped": 0, "failures": [], "outputTail": tail(tout + terr)}

        return {
            "install": {"ok": install_ok, "logTail": tail(install_log), "cached": from_cache},
            "compile": {"ok": not compile_errors, "errors": compile_errors},
            "lint": {"issues": lint[:30]},
            "tests": tests_result,
            "failToPass": fail_to_pass,
            "security": security,
            "durationMs": int((time.time() - started) * 1000),
        }
    finally:
        sb.terminate()


@app.function(
    image=web_image,
    secrets=[modal.Secret.from_name("thepolisher-sandbox")],
    volumes={CACHE_DIR: deps_volume},
    timeout=900,
    # Each request mostly waits on its own Sandbox; a run checks 3 drafts at once.
    max_containers=10,
)
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
        testScope: Literal["targeted", "full"] = "full"

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

    api = FastAPI(title="ThePolisher sandbox", docs_url=None, redoc_url=None, openapi_url=None)
    auth_scheme = HTTPBearer()

    @api.post("/validate")
    def validate(req: ValidateRequest, token: HTTPAuthorizationCredentials = Depends(auth_scheme)) -> dict:
        if not hmac.compare_digest(token.credentials.encode(), os.environ["SANDBOX_TOKEN"].encode()):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        try:
            return validate_patch(req.repo, req.sha, req.changes, req.newTests, req.testScope)
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return api
