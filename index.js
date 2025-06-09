const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const app = express();
const port = process.env.PORT || 3000;

dotenv.config();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const {
  GITHUB_TOKEN,
  GITHUB_REPO,
  GITHUB_FILE_PATH
} = process.env;

let lastUpdated = null;

async function getFileInfo() {
  const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json"
    }
  });
  return res.data;
}

app.get("/", async (req, res) => {
  try {
    const file = await getFileInfo();
    const content = Buffer.from(file.content, "base64").toString("utf-8");
    const updatedAgo = lastUpdated
      ? `${Math.floor((Date.now() - lastUpdated) / 1000)} seconds ago`
      : "N/A";

    res.send(`
      <html>
        <head><title>GitHub File Editor</title></head>
        <body style="font-family: monospace; padding: 2rem;">
          <h2>📝 GitHub File Editor</h2>
          <p><strong>Last updated:</strong> ${updatedAgo}</p>
          <form method="POST" action="/update">
            <textarea name="content" style="width:100%;height:300px;">${content}</textarea><br><br>
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

    await axios.put(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
      message: "Updated via GitHub Web Editor",
      content: contentEncoded,
      sha: file.sha
    }, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    lastUpdated = Date.now();
    res.redirect("/");
  } catch (err) {
    res.status(500).send("Update failed: " + err.message);
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
