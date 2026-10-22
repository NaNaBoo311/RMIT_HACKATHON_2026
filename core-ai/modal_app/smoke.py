"""Check Modal + GPU + volume work.  Run: uv run modal run -m modal_app.smoke"""

from modal_app.common import VOLUMES, app, image


@app.function(image=image, gpu="L4", volumes=VOLUMES, timeout=300)
def check():
    import os

    import torch

    print(
        "cuda:",
        torch.cuda.is_available(),
        torch.cuda.get_device_name(0) if torch.cuda.is_available() else "",
    )
    print("volume /vol:", os.listdir("/vol"))
    data = "/vol/data"
    print(
        "data files:",
        os.listdir(data)
        if os.path.exists(data)
        else "(none yet - run scripts/push_data.sh)",
    )


@app.local_entrypoint()
def main():
    check.remote()
