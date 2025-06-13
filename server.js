import { createClient } from "@supabase/supabase-js";
import { OpenAI } from "openai";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const openAIKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
}

if (!openAIKey) {
  throw new Error("OPENAI_API_KEY environment variable is required");
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchMoments() {
  try {
    const { data, error } = await supabase
      .from("Moments")
      .select("playerName, highlightInfo");

    if (error) {
      console.error("Error fetching moments:", error);
      return;
    }
    return data;
  } catch (error) {
    console.error("Unexpected error:", error);
  }
}
let momentData = await fetchMoments();

async function generateEmbeddings() {
  const openai = new OpenAI({ apiKey: openAIKey });

  for (let i = 0; i < Math.min(momentData.length, 5); i++) {
    const moment = momentData[i];
    const input = (moment.playerName + moment.highlightInfo).replace(/\n/g, "");
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input,
    });

    // console.log(embeddingResponse)
    const [{ embedding }] = embeddingResponse.data;
    await supabase.from("documents").insert({
      content: moment,
      embedding,
    });
  }
}

// generateEmbeddings();

async function askQuestion() {
  console.log('data');

  const { data } = await supabase.functions.invoke("ask-custom-data", {
    body: JSON.stringify({
      query:
        "based on my collection, do I have the cards to complete this challenge: Earn the Jalen Rose Reward Moment by locking the Run It Back Moments of each of the following players: Chris Paul Kendall Gill Dwight Howard Shawn Bradley Donyell Marshall",
    }),
  });

  console.log(data);
  return 'success'
}

askQuestion();
