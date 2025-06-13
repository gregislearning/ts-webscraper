import { createClient } from "@supabase/supabase-js";
import { OpenAI } from "openai";

const supabaseUrl = "https://azrdgjhkjkizrologhiy.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6cmRnamhramtpenJvbG9naGl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDIwOTk1MDEsImV4cCI6MjAxNzY3NTUwMX0.CattFx1UV5odxvxsku1dHvyJsTpa6_SS791y5cnPM7Y";
const supabase = createClient(supabaseUrl, supabaseKey);
const openAIKey =
  "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";

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
