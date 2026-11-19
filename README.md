# Private Fuzzy Left Join — Didactic Simulator

Interactive 6-step teaching simulator illustrating the **Ordered Threshold-One (OTO)** private fuzzy left join from Han, Kim, and Son (*Private Computation on Common Fuzzy Records*, PoPETs 2025) for the Advanced Cybersecurity presentation (Topic A7).

## Open locally

Double-click `index.html` (or open it in any modern browser). No build step, server, or internet connection is required.

## Deploy on GitHub Pages

1. Push the contents of this folder (`index.html`, `style.css`, `app.js`, `README.md`) to a GitHub repository's `main` branch root.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, choose `main` and `/ (root)`, then click **Save**.

## Deploy on Vercel

1. Import the repository in Vercel.
2. Set **Framework Preset** to **Other**, leave **Build Command** empty, and set **Output Directory** to `.`.
3. Click **Deploy**.

## Limits

This tool is a didactic browser simulation using `Math.random()` and central computation to illustrate secret shares and OTO matching—it is **not** real cryptography and must never be used with real personal data.
