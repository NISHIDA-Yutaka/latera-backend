require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());
app.use(express.json());

const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);


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
    const allArticles = await pool.query("SELECT * FROM articles WHERE is_archived = false ORDER BY id DESC");
    res.json(allArticles.rows);
  } catch (error) {
    // console.error("Error fetching articles:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/articles", async (req, res) => {
  try {
    const { title, url, thumbnail_url } = req.body;

    // First, insert the article into the database with a placeholder content
    const newArticle = await pool.query(
      "INSERT INTO articles (title, url, content, thumbnail_url, is_summarized) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [title, url, "Summarizing content...", thumbnail_url, false]
    );

    // Then, start the summarization process in the background
    summarizeArticle(url).then(async summarizedContent => {
      // Once the content is summarized, update the article in the database
      await pool.query(
        "UPDATE articles SET content = $1, is_summarized = $2 WHERE id = $3",
        [summarizedContent, true, newArticle.rows[0].id]
      );
    }).catch(error => {
      console.error("Error summarizing article:", error);
    });

    res.json(newArticle.rows[0]);
  } catch (error) {
    console.error("Error inserting article:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/articles/:id/archive", async (req, res) => {
  try {
    const { id } = req.params;

    // Update the article to set is_archived to true
    await pool.query(
      "UPDATE articles SET is_archived = $1 WHERE id = $2",
      [true, id]
    );

    res.status(204).end(); // Send back a 204 No Content response
  } catch (error) {
    console.error("Error archiving article:", error);
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
    // console.error("Error fetching article info:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.patch("/articles/:id/refresh-summary", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query("SELECT url FROM articles WHERE id = $1", [id]);
    const url = rows[0]?.url;
    if (!url) {
      res.status(404).json({ message: "Article not found." });
      return;
    }

    // Set the content to 'Summarizing content...' initially
    await pool.query("UPDATE articles SET content = $1 WHERE id = $2", ['Summarizing content...', id]);

    const newSummary = await summarizeArticle(url);

    await pool.query("UPDATE articles SET content = $1 WHERE id = $2", [newSummary, id]);
    res.json({ message: "Article summary refreshed successfully." });
  } catch (error) {
    console.error("Error refreshing article summary:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.delete("/articles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM articles WHERE id = $1", [id]);
    res.status(204).send();
  } catch (error) {
    // console.error("Error deleting article:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


async function summarizeArticle(url) {
  try {
    let formattedBody = await fetchArticleContent(url);
    const contentLength = formattedBody.length;

    if (isSplitArticle(contentLength)) {
      formattedBody = await summarizeParts(formattedBody);
    }

    let finalSummary = await getSummarizeAll(formattedBody);
    if (finalSummary == "") { finalSummary = "error..." }

    return finalSummary;
  } catch (error) {
    console.error("Error summarizing article:", error);
    return null;
  }
}

async function summarizeParts(text) {
  const paragraphs = text.split(/\n{2,}/);
  let combinedText = "";
  let partialSummaries = [];

  const splitLength = Math.round(text.length / 3000);
  let lengthLimit = 0;

  if (!splitLength == 0) {
    console.log(splitLength);
    lengthLimit = (3000 / splitLength);
  }

  for (const paragraph of paragraphs) {
    if (combinedText.length + paragraph.length > 3000) {
      const partialSummary = await getSummarizeParts(combinedText, lengthLimit);
      partialSummaries.push(partialSummary);
      combinedText = paragraph;
    } else {
      combinedText += `\n\n${paragraph}`;
    }
  }

  if (combinedText) {
    const partialSummary = await getSummarizeParts(combinedText, lengthLimit);
    partialSummaries.push(partialSummary);
  }

  return partialSummaries.join("\n\n");
}

function isSplitArticle(contentLength, threshold = 3000) {
  return contentLength > threshold;
}

async function getSummarizeParts(text,lengthLimit) {
  const prompt = `
  下記の記事を日本語で要約してください。
  ただし、要約後の文章が${lengthLimit}文字を超えないようにしてください。

  ${text}
  `;

  const response = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [{role: "user", content: prompt}],
  });

  const summary = response.data.choices[0].message;

  return summary;
}

async function getSummarizeAll(text) {
  const prompt = `
  下記の記事を日本語で要約してください。

  # 条件
  - 箇条書きで内容を書いてください
  - html形式で装飾してください

  # 雛形
  <ul>
    <li>ここに要約が入る</li>
    <li>ここに要約が入る</li>
    <li>ここに要約が入る</li>
    <li>ここに要約が入る</li>
    <li>ここに要約が入る</li>
  </ul>

  # 記事
  ${text}
  `;

  const response = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [{role: "user", content: prompt}],
  });

  const summary = response.data.choices[0].message.content;

  return summary;
}

async function fetchArticleContent(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    let contentElement;
    if ($("article").length) {
      contentElement = $("article");
    } else if ($("main").length) {
      contentElement = $("main");
    } else {
      contentElement = $("body");
    }

    const content = removeUnwantedTags(contentElement);

    return content;
  } catch (error) {
    // console.error("Error fetching article content:", error);
    return null;
  }
}

function removeUnwantedTags(element) {
  element.find("script, style, link, img, nav, header, footer, aside, form, noscript, iframe, figure, figcaption").remove();
  return element.text().trim();
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
