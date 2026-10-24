# Natural voice for DJ mode and radio announcements: KittenTTS (small ONNX
# models, runs on the CPU). The model downloads on first start into /cache.
FROM python:3.12-slim
ENV PIP_NO_CACHE_DIR=1 HF_HOME=/cache PYTHONUNBUFFERED=1
# misaki[en] would pull PyTorch (several GB) for a transformer option KittenTTS never uses: install its parts
# by hand instead, which keeps the image small.
RUN pip install --no-deps https://github.com/KittenML/KittenTTS/releases/download/0.8.1/kittentts-0.8.1-py3-none-any.whl "misaki>=0.9.4" \
 && pip install onnxruntime soundfile numpy huggingface_hub num2words spacy espeakng_loader phonemizer-fork addict regex \
 && python -m spacy download en_core_web_sm
COPY server.py /app/server.py
EXPOSE 8020
CMD ["python", "/app/server.py"]
