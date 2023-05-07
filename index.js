const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());
app.use(express.json());

const openai = require("openai");

openai.apiKey = "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";

const pool = new Pool({
  // PostgreSQLデータベースの接続情報を設定する
  user: "latera_user",
  host: "localhost",
  database: "latera_db",
  password: "Nimotsu6150",
  port: 5432 // PostgreSQLのデフォルトポート
});

app.get("/articles", async (req, res) => {
  try {
    const allArticles = await pool.query("SELECT * FROM articles ORDER BY id DESC");
    res.json(allArticles.rows);
  } catch (error) {
    console.error("Error fetching articles:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/articles", async (req, res) => {
  try {
    const { title, url, thumbnail_url } = req.body;

    const fullContent = await fetchArticleContent(url);
    const summarizedContent = await summarizeArticle(fullContent);

    const newArticle = await pool.query(
      "INSERT INTO articles (title, url, content, thumbnail_url) VALUES ($1, $2, $3, $4) RETURNING *",
      [title, url, summarizedContent, thumbnail_url]
    );

    res.json(newArticle.rows[0]);
  } catch (error) {
    console.error("Error inserting article:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/articleinfo", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      res.status(400).json({ message: "URL query parameter is required." });
      return;
    }

    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const title = $("head title").text();
    const imageUrl = $('meta[property="og:image"]').attr("content") || "";

    res.json({
      title: title,
      content: "",
      imageUrl: imageUrl,
    });

  } catch (error) {
    console.error("Error fetching article info:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.delete("/articles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM articles WHERE id = $1", [id]);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting article:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


async function fetchArticleContent(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const content = $("body").text().trim();

    console.log(content);

    return content;
  } catch (error) {
    console.error("Error fetching article content:", error);
    return null;
  }
}

function isSplitArticle(contentLength, threshold = 3000) {
  return contentLength > threshold;
}

async function summarizeArticle(formattedBody) {
  try {
    const contentLength = formattedBody.length

    if (isSplitArticle(contentLength)) {

    }

    const prompt = `要約：\n\n${formattedBody}\n\n要約：`;

    const response = await openai.Completion.create({
      engine: "text-davinci-002",
      prompt: prompt,
      max_tokens: 150,
      n: 1,
      stop: null,
      temperature: 0.5,
    });

    const summary = response.choices[0].text.trim();

    return summary;
  } catch (error) {
    console.error("Error summarizing article:", error);
    return null;
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
