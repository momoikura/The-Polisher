"""ThePolisher's API server on Modal.

Runs the bundled Node server (packages/web/dist-server/server.mjs) as a Modal
web server. Exactly one container, always warm: live runs are held in that
container's memory, so a second container couldn't reattach to them, and a cold
start would make the first visitor wait.

Secrets:
  thepolisher-web      site settings (deploy/set-secrets.ps1)
  thepolisher-web-aws  access key of the IAM user "thepolisher-web", whose only
                       permission is deploy/aws/dynamodb-policy.json. (AWS projects
                       on the new experience block OIDC providers, so keyless
                       federation from Modal isn't available.)

Deploy (from the repo root, after `pnpm --filter @thepolisher/web build:server`):
    modal deploy deploy/modal_web.py
"""

import os
import pathlib
import subprocess

import modal

APP_NAME = "thepolisher-web"
PORT = 8000
BUNDLE = pathlib.Path(__file__).resolve().parent.parent / "packages/web/dist-server/server.mjs"
# Long enough for a whole run's live updates on one connection.
REQUEST_TIMEOUT_S = 60 * 60

image = modal.Image.from_registry("node:22-slim", add_python="3.12").add_local_file(BUNDLE, "/app/server.mjs")
app = modal.App(APP_NAME)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("thepolisher-web"), modal.Secret.from_name("thepolisher-web-aws")],
    min_containers=1,
    max_containers=1,
    cpu=0.25,
    memory=512,
    timeout=REQUEST_TIMEOUT_S,
)
@modal.concurrent(max_inputs=1000)
@modal.web_server(PORT, startup_timeout=30)
def api():
    # AWS_ROLE_ARN is a leftover from the OIDC attempt; dropping it keeps the SDK on the access key.
    env = {k: v for k, v in os.environ.items() if k != "AWS_ROLE_ARN"}
    subprocess.Popen(["node", "/app/server.mjs"], env={**env, "PORT": str(PORT)})
