const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));

const {
  GITHUB_TOKEN,
  GITHUB_REPO,
  GITHUB_FILE_PATH
} = process.env;

async function getFileInfo() {
  const res = await axios.get(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    }
  );
  return res.data;
}

async function getLastCommitTime() {
  const res = await axios.get(
    `https://api.github.com/repos/${GITHUB_REPO}/commits?path=${GITHUB_FILE_PATH}&page=1&per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    }
  );
  return new Date(res.data[0].commit.committer.date);
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

app.get("/", async (req, res) => {
  try {
    const file = await getFileInfo();
    const content = Buffer.from(file.content, "base64").toString("utf-8");
    const lastCommitDate = await getLastCommitTime();
    const updatedAgo = timeAgo(lastCommitDate);

    res.send(`
      <html>
        <head>
          <title>GitHub File Editor</title>
          <style>
            body { font-family: monospace; padding: 2rem; background:#f7f7f7; }
            textarea { width: 100%; height: 300px; font-family: monospace; font-size: 14px; }
            button { padding: 10px 15px; font-size: 16px; cursor: pointer; }
          </style>
        </head>
        <body>
          <h2>📝 GitHub File Editor</h2>
          <p><strong>Last updated:</strong> ${updatedAgo}</p>
          <form method="POST" action="/update">
            <textarea name="content">${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</textarea><br><br>
            <button type="submit">💾 Save</button>
          </form>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Failed to load file: " + err.message);
  }
});

app.post("/update", async (req, res) => {
  try {
    const file = await getFileInfo();
    const contentEncoded = Buffer.from(req.body.content).toString("base64");

    await axios.put(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
      {
        message: "Updated via GitHub Web Editor",
        content: contentEncoded,
        sha: file.sha
      },
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    res.redirect("/");
  } catch (err) {
    res.status(500).send("Update failed: " + err.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
