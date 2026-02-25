require("dotenv").config();
const axios = require("axios");

const BASE_URL = "https://api.getbase.com/v2";
const TOKEN = process.env.SELL_ACCESS_TOKEN;
const USER_AGENT = process.env.SELL_USER_AGENT || "ClinycoPortal/1.0";

if (!TOKEN) {
  console.warn("⚠️ SELL_ACCESS_TOKEN not set");
}

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Accept: "application/json"
  }
});

// =========================
// PIPELINES
// =========================

async function getPipelines() {
  const res = await api.get("/pipelines");
  return (res.data.items || []).map((p) => ({
    id: p.id,
    name: p.name
  }));
}

// =========================
// OWNERS (USERS)
// =========================

async function getOwners() {
  const res = await api.get("/users");
  return (res.data.items || [])
    .filter((u) => u.status === "active")
    .map((u) => ({
      id: u.id,
      name: u.name
    }));
}

// =========================
// LIST CHOICES (Deal fields)
// =========================

async function getDealListChoices(fieldName) {
  const res = await api.get("/deal_custom_fields");

  const field = (res.data.items || []).find(
    (f) => f.name.toUpperCase() === fieldName.toUpperCase()
  );

  if (!field || !field.options) return [];

  return field.options.map((opt) => ({
    id: opt.id,
    name: opt.name
  }));
}

// =========================
// CREATE CONTACT
// =========================

async function createContact(payload) {
  const res = await api.post("/contacts", payload);
  return res.data;
}

// =========================
// CREATE DEAL
// =========================

async function createDeal(payload) {
  const res = await api.post("/deals", payload);
  return res.data;
}

// =========================
// EXPORTS
// =========================

module.exports = {
  getPipelines,
  getOwners,
  getDealListChoices,
  createContact,
  createDeal
};
