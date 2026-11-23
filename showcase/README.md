# Chawk static showcase

This directory is a self-contained, Netlify-ready showcase. It has no backend and no API calls: the proofs and equations are precomputed, and the full tracer is run locally via Docker.

## Deploy

### Netlify Drop

Drag the `showcase` folder onto <https://app.netlify.com/drop>. No build step is needed.

### Git-connected site

Connect this repository to Netlify. The checked-in `netlify.toml` at the repository root sets:

- base directory: `showcase`
- publish directory: `.`
- no build command
- one-day revalidated caching for `assets/` and `vendor/`
- baseline security headers

Netlify runs dependency detection from the base directory. Since the base is `showcase`, it never sees the app's root `requirements.txt` and does not install Python, NumPy, OpenCV, SciPy, or Matplotlib.

### CLI

```bash
npx netlify-cli login
npx netlify-cli deploy --prod --dir=showcase
```

## What is real here

- Five real proofs, their rebuilt renders, and their original images.
- The full equation counts: 25,603 across the five.
- The exact pipeline description: OpenCV ink mask, contour extraction, RDP, primitive fitting, Matplotlib.
- The same light/dark design system as the app, including system preference, persistence, and no-flash load.

The full tracer is **not** running on Netlify. It needs Python, OpenCV, and Matplotlib; run it with:

```bash
docker run --rm -p 8010:8000 ghcr.io/hello2himel/chawk:latest
```

or see the main [README](../README.md).
