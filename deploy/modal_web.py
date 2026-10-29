"""ThePolisher's API server on Modal.

Runs the bundled Node server (packages/web/dist-server/server.mjs) as a Modal
web server. Exactly one container, always warm: live runs are held in that
container's memory, so a second container couldn't reattach to them, and a cold
start would make the first visitor wait.

AWS access uses Modal's OIDC identity token, not stored AWS keys: the container
exchanges its token for short-lived credentials for the IAM role in
AWS_ROLE_ARN (see deploy/aws/).

Deploy (from the repo root, after `pnpm --filter @thepolisher/web build:server`):
    modal deploy deploy/modal_web.py
"""

import base64
import json
import os
import pathlib
import subprocess

import modal

APP_NAME = "thepolisher-web"
PORT = 8000
BUNDLE = pathlib.Path(__file__).resolve().parent.parent / "packages/web/dist-server/server.mjs"
TOKEN_FILE = "/tmp/modal-identity-token"
# Long enough for a whole run's live updates on one connection.
REQUEST_TIMEOUT_S = 60 * 60

image = modal.Image.from_registry("node:22-slim", add_python="3.12").add_local_file(BUNDLE, "/app/server.mjs")
app = modal.App(APP_NAME)


def token_subject(token: str) -> str:
    """The token's `sub` claim (not secret), which the IAM role's trust policy matches."""
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"]


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("thepolisher-web")],
    min_containers=1,
    max_containers=1,
    cpu=0.25,
    memory=512,
    timeout=REQUEST_TIMEOUT_S,
)
@modal.concurrent(max_inputs=1000)
@modal.web_server(PORT, startup_timeout=30)
def api():
    env = {k: v for k, v in os.environ.items() if k != "MODAL_IDENTITY_TOKEN"}
    env["PORT"] = str(PORT)
    token = os.environ.get("MODAL_IDENTITY_TOKEN")
    if token and env.get("AWS_ROLE_ARN"):
        path = pathlib.Path(TOKEN_FILE)
        path.write_text(token)
        path.chmod(0o600)
        env["AWS_WEB_IDENTITY_TOKEN_FILE"] = TOKEN_FILE
        env["AWS_ROLE_SESSION_NAME"] = APP_NAME
        print(f"AWS access via OIDC; token subject: {token_subject(token)}")
    else:
        print("No MODAL_IDENTITY_TOKEN or AWS_ROLE_ARN: DynamoDB calls will fail.")
    subprocess.Popen(["node", "/app/server.mjs"], env=env)
