# Chawk — line art -> equations, one container.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/home/chawk/.cache/matplotlib \
    PORT=8000

# libGL / glib for opencv-python, libgomp for its parallel kernels.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so the expensive layer caches.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py lineart2eq.py ./
COPY chawk ./chawk
COPY frontend ./frontend

# Run as a non-root user; matplotlib writes its font cache under its home.
RUN useradd --create-home --uid 10001 chawk \
 && chown -R chawk:chawk /app
USER chawk

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)"

CMD ["sh", "-c", "exec python app.py --host 0.0.0.0 --port ${PORT:-8000}"]
