"""Shared Modal app, image and volume. All Modal entrypoints import from here."""

import modal

from rmit_hack import config

app = modal.App("rmit-hack-2026")

volume = modal.Volume.from_name(config.MODAL_VOLUME, create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "torch==2.8.0",
        "transformers>=4.56",
        "accelerate>=1.10",
        "sentencepiece",
        "protobuf",
        "pandas",
        "scikit-learn",
        "pyarrow",
    )
    .env({"HF_HOME": "/vol/hf_cache", "TOKENIZERS_PARALLELISM": "false"})
    .add_local_python_source("rmit_hack", "modal_app")
)

VOLUMES = {str(config.MODAL_MOUNT): volume}
