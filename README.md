# coach-setup

Settings page for Canvas Coach, hosted with GitHub Pages:
**https://codeted323.github.io/coach-setup/**

The page holds no data. It loads and saves `config.json` in the private `canvas-coach` repo through the GitHub API, using a fine-grained token you paste into the page. That token stays in your browser (only if you tick "Remember").

Performance dashboard: **https://codeted323.github.io/coach-setup/dashboard.html**. It's empty until you unlock it with the same token, then it loads `state/dashboard.json` from the private repo.

Assignments table: **https://codeted323.github.io/coach-setup/assignments.html** (same token).

To update the page, copy `setup.html` from `canvas-coach` over `index.html` here.
