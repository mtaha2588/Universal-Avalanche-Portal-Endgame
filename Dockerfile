# Container image for cloud hosting (Railway; also works on Hugging Face Spaces, Render, Fly.io).
# Secrets are NOT baked in: set MAPBOX_TOKEN and SECRET_KEY as the host's environment variables.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOST=0.0.0.0 \
    PORT=8080 \
    FLASK_DEBUG=0

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN useradd --create-home portal && chown -R portal /app
USER portal

# The host sets PORT at runtime; app.py reads it from the environment.
EXPOSE 8080
CMD ["python", "app.py"]
