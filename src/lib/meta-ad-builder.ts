import { getConnectionConfig } from "./connection-config";

export type MetaAdBuilderCatalog = {
  connected: boolean;
  accountId: string;
  accountName: string;
  currency: string;
  pageId: string;
  pageName: string;
  forms: Array<{ id: string; name: string; status: string; createdTime: string | null }>;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    effectiveStatus: string;
    objective: string;
    specialAdCategories: string[];
  }>;
};

export type MetaAdDraft = {
  campaignMode: "new" | "existing";
  campaignId?: string | null;
  campaignName?: string | null;
  formId: string;
  dailyBudget: number;
  daysRequired: number;
  adName: string;
  adSetName: string;
  creativeName: string;
  primaryText: string;
  headline: string;
  description?: string | null;
  imageHash?: string | null;
  posterUrl?: string | null;
  destinationUrl: string;
  callToAction: "APPLY_NOW" | "SIGN_UP" | "LEARN_MORE";
  audience: MetaLocationAudience;
};

export const META_AUDIENCE_RADIUS_MIN_KM = 15;
export const META_AUDIENCE_RADIUS_MAX_KM = 18;
export const META_AUDIENCE_RADIUS_DEFAULT_KM = 15;

export type MetaLocationAudience = {
  locationId: string;
  stationCode: string;
  stationName: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
  source: "station_contacts";
};

export type MetaPublishProgress = {
  campaignId?: string;
  adSetId?: string;
  creativeId?: string;
  adId?: string;
};

type MetaGraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
};

type MetaGraphPayload = Record<string, unknown> & { error?: MetaGraphError };

function normalizedAccountId(value: string) {
  return value.trim().replace(/^act_/i, "");
}

function requireHttpUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a complete HTTPS link.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  return parsed.toString();
}

export function validateMetaLocationAudience(input: MetaLocationAudience): MetaLocationAudience {
  const coordinate = (value: unknown) => value == null || String(value).trim() === ""
    ? Number.NaN
    : Number(value);
  const latitude = coordinate(input?.latitude);
  const longitude = coordinate(input?.longitude);
  const radiusKm = Number(input?.radiusKm);
  if (!String(input?.locationId || "").trim() || !String(input?.stationCode || "").trim()) {
    throw new Error("The station audience is missing. Reopen the publisher from the approved request.");
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error(`Add valid latitude and longitude for ${String(input?.stationCode || "this station")} in Master → Station Contacts before publishing.`);
  }
  if (!Number.isInteger(radiusKm)
    || radiusKm < META_AUDIENCE_RADIUS_MIN_KM
    || radiusKm > META_AUDIENCE_RADIUS_MAX_KM) {
    throw new Error(`Audience radius must be between ${META_AUDIENCE_RADIUS_MIN_KM} and ${META_AUDIENCE_RADIUS_MAX_KM} km.`);
  }
  return {
    locationId: String(input.locationId).trim(),
    stationCode: String(input.stationCode).trim().toUpperCase(),
    stationName: String(input.stationName || input.stationCode).trim(),
    address: String(input.address || "").trim() || null,
    latitude,
    longitude,
    radiusKm,
    source: "station_contacts"
  };
}

export function validateMetaAdDraft(input: MetaAdDraft): MetaAdDraft {
  const dailyBudget = Number(input.dailyBudget);
  const daysRequired = Math.trunc(Number(input.daysRequired));
  const campaignMode = input.campaignMode === "existing" ? "existing" : "new";
  if (campaignMode === "existing" && !String(input.campaignId || "").trim()) {
    throw new Error("Choose an existing Meta lead campaign.");
  }
  if (campaignMode === "new" && !String(input.campaignName || "").trim()) {
    throw new Error("Enter the new campaign name.");
  }
  if (!String(input.formId || "").trim()) throw new Error("Choose a Meta instant form.");
  if (!Number.isFinite(dailyBudget) || dailyBudget < 100) {
    throw new Error("Daily budget must be at least ₹100.");
  }
  if (!Number.isFinite(daysRequired) || daysRequired < 1 || daysRequired > 90) {
    throw new Error("Duration must be between 1 and 90 days.");
  }
  if (!String(input.primaryText || "").trim()) throw new Error("Enter the primary ad text.");
  if (!String(input.headline || "").trim()) throw new Error("Enter the ad headline.");
  if (!String(input.adName || "").trim()) throw new Error("Enter the ad name.");
  if (!String(input.adSetName || "").trim()) throw new Error("Enter the ad set name.");
  if (!String(input.creativeName || "").trim()) throw new Error("Enter the creative name.");
  const imageHash = String(input.imageHash || "").trim();
  const posterUrl = String(input.posterUrl || "").trim();
  if (!imageHash && !posterUrl) throw new Error("Upload a poster before reviewing the ad.");
  if (imageHash && !/^[A-Za-z0-9_-]{16,256}$/.test(imageHash)) {
    throw new Error("The uploaded poster reference is invalid. Upload the poster again.");
  }
  const callToAction = ["APPLY_NOW", "SIGN_UP", "LEARN_MORE"].includes(input.callToAction)
    ? input.callToAction
    : "APPLY_NOW";
  const audience = validateMetaLocationAudience(input.audience);
  return {
    ...input,
    campaignMode,
    campaignId: String(input.campaignId || "").trim() || null,
    campaignName: String(input.campaignName || "").trim() || null,
    formId: String(input.formId).trim(),
    dailyBudget,
    daysRequired,
    adName: String(input.adName).trim(),
    adSetName: String(input.adSetName).trim(),
    creativeName: String(input.creativeName).trim(),
    primaryText: String(input.primaryText).trim(),
    headline: String(input.headline).trim(),
    description: String(input.description || "").trim() || null,
    imageHash: imageHash || null,
    posterUrl: posterUrl ? requireHttpUrl(posterUrl, "Poster link") : null,
    destinationUrl: requireHttpUrl(String(input.destinationUrl || ""), "Destination link"),
    callToAction,
    audience
  };
}

export async function uploadMetaAdImage(input: {
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
}) {
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(input.contentType)) throw new Error("Upload a JPG, PNG or WebP poster.");
  if (!input.bytes.byteLength || input.bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error("Poster size must be between 1 byte and 12 MB.");
  }
  const connection = await metaConnection();
  const path = `act_${connection.accountId}/adimages`;
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  const url = `https://graph.facebook.com/${connection.graphVersion}/${encodedPath}`;
  const body = new FormData();
  body.append("filename", new Blob([input.bytes], { type: input.contentType }), input.fileName || "dropx-poster.jpg");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.accessToken}` },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(45_000)
  });
  const payload = await response.json() as MetaGraphPayload & {
    images?: Record<string, { hash?: string; url?: string; permalink_url?: string; width?: number; height?: number }>;
  };
  if (!response.ok || payload.error) {
    const detail = payload.error?.error_user_msg || payload.error?.message;
    const suffix = payload.error?.code
      ? ` [Meta ${payload.error.code}${payload.error.error_subcode ? `/${payload.error.error_subcode}` : ""}]`
      : "";
    throw new Error(`${detail || `Meta returned HTTP ${response.status}.`}${suffix}`);
  }
  const uploaded = Object.values(payload.images || {})[0];
  const imageHash = String(uploaded?.hash || "").trim();
  if (!imageHash) throw new Error("Meta accepted the upload but did not return an image reference.");
  const previewUrl = String(uploaded?.permalink_url || uploaded?.url || "").trim();
  return {
    imageHash,
    previewUrl: previewUrl.startsWith("https://") ? previewUrl : null,
    width: Number(uploaded?.width || 0) || null,
    height: Number(uploaded?.height || 0) || null
  };
}

export function metaDailyBudgetMinorUnits(value: number) {
  return String(Math.round(Number(value) * 100));
}

export function buildEmploymentCampaignValues(name: string) {
  return {
    name,
    objective: "OUTCOME_LEADS",
    buying_type: "AUCTION",
    ...buildAdSetBudgetCampaignValues(),
    special_ad_categories: JSON.stringify(["EMPLOYMENT"]),
    special_ad_category_country: JSON.stringify(["IN"]),
    status: "PAUSED"
  };
}

export function buildAdSetBudgetCampaignValues() {
  return {
    // The approved daily budget is owned by the ad set, not the campaign.
    // Meta validates this choice on the campaign object (100/4834011).
    is_adset_budget_sharing_enabled: "false"
  };
}

export function buildEmploymentAdSetValues(input: {
  name: string;
  campaignId: string;
  dailyBudget: number;
  pageId: string;
  daysRequired: number;
  audience: MetaLocationAudience;
  now?: Date;
}) {
  const audience = validateMetaLocationAudience(input.audience);
  const start = new Date((input.now ?? new Date()).getTime() + 10 * 60_000);
  const end = new Date(start.getTime() + input.daysRequired * 24 * 60 * 60_000);
  return {
    name: input.name,
    campaign_id: input.campaignId,
    daily_budget: metaDailyBudgetMinorUnits(input.dailyBudget),
    billing_event: "IMPRESSIONS",
    optimization_goal: "LEAD_GENERATION",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    promoted_object: JSON.stringify({ page_id: input.pageId }),
    targeting: JSON.stringify({
      geo_locations: {
        custom_locations: [{
          latitude: audience.latitude,
          longitude: audience.longitude,
          radius: audience.radiusKm,
          distance_unit: "kilometer"
        }],
        location_types: ["home", "recent"]
      }
    }),
    destination_type: "ON_AD",
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: "PAUSED"
  };
}

async function metaConnection() {
  const config = await getConnectionConfig("meta");
  const accountId = normalizedAccountId(config?.publicConfig.ad_account_id || "");
  const pageId = String(config?.publicConfig.page_id || "").trim();
  const accessToken = String(config?.secrets.access_token || "").trim();
  const pageAccessToken = String(config?.secrets.page_access_token || "").trim();
  if (!config?.isEnabled || !accountId || !pageId || !accessToken) {
    throw new Error("Meta Lead Ads must be enabled with an Ad Account, Page and access token.");
  }
  return {
    accountId,
    pageId,
    accessToken,
    pageAccessToken,
    graphVersion: config.publicConfig.graph_version || "v25.0"
  };
}

async function graphRequest(
  connection: Awaited<ReturnType<typeof metaConnection>>,
  path: string,
  method: "GET" | "POST" = "GET",
  values?: Record<string, string>
) {
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  const url = new URL(`https://graph.facebook.com/${connection.graphVersion}/${encodedPath}`);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
    },
    body: method === "POST" ? new URLSearchParams(values ?? {}) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json() as MetaGraphPayload;
  if (!response.ok || payload.error) {
    const detail = payload.error?.error_user_msg || payload.error?.message;
    const suffix = payload.error?.code
      ? ` [Meta ${payload.error.code}${payload.error.error_subcode ? `/${payload.error.error_subcode}` : ""}]`
      : "";
    throw new Error(`${detail || `Meta returned HTTP ${response.status}.`}${suffix}`);
  }
  return payload;
}

export async function setMetaObjectStatus(objectId: string, status: "ACTIVE" | "PAUSED") {
  const id = String(objectId || "").trim();
  if (!id) throw new Error("Meta object ID is missing.");
  const connection = await metaConnection();
  await graphRequest(connection, id, "POST", { status });
}

export async function setMetaObjectName(objectId: string, name: string) {
  const id = String(objectId || "").trim();
  const nextName = String(name || "").trim();
  if (!id) throw new Error("Meta object ID is missing.");
  if (!nextName) throw new Error("Meta object name is missing.");
  const connection = await metaConnection();
  await graphRequest(connection, id, "POST", { name: nextName });
}

async function graphGet(
  connection: Awaited<ReturnType<typeof metaConnection>>,
  path: string,
  query: Record<string, string>,
  accessToken = connection.accessToken
) {
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  const url = new URL(`https://graph.facebook.com/${connection.graphVersion}/${encodedPath}`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json() as MetaGraphPayload;
  if (!response.ok || payload.error) {
    const detail = payload.error?.error_user_msg || payload.error?.message;
    const suffix = payload.error?.code ? ` [Meta ${payload.error.code}]` : "";
    throw new Error(`${detail || `Meta returned HTTP ${response.status}.`}${suffix}`);
  }
  return payload;
}

type MetaObject = Record<string, unknown>;

export type MetaAdCreativeReplacementContext = {
  adId: string;
  adName: string;
  configuredStatus: string;
  effectiveStatus: string;
  creativeId: string;
  creativeName: string;
  posterUrl: string | null;
  primaryText: string;
  headline: string;
  description: string;
  callToAction: string;
  replaceable: boolean;
  replacementBlocker: string | null;
  objectStorySpec: MetaObject;
};

function metaObject(value: unknown): MetaObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MetaObject
    : {};
}

function safeMetaImageUrl(value: unknown) {
  const url = String(value || "").trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function requireMetaObjectId(value: string, label: string) {
  const id = String(value || "").trim();
  if (!/^\d{5,30}$/.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

export function buildReplacementObjectStorySpec(value: unknown, imageHash: string) {
  const hash = String(imageHash || "").trim();
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(hash)) {
    throw new Error("The uploaded poster reference is invalid. Upload the poster again.");
  }
  const source = metaObject(value);
  const linkData = metaObject(source.link_data);
  if (!Object.keys(linkData).length) {
    throw new Error("This ad uses a creative format that cannot be replaced from Recruitment yet.");
  }
  if (Array.isArray(linkData.child_attachments) && linkData.child_attachments.length) {
    throw new Error("Carousel creatives cannot be replaced with a single poster.");
  }
  const pageId = String(source.page_id || "").trim();
  const link = String(linkData.link || "").trim();
  if (!/^\d{5,30}$/.test(pageId) || !link) {
    throw new Error("The current creative is missing its Page or destination link.");
  }

  // Meta's read representation can contain legacy/output-only fields that
  // cannot be submitted back to the create endpoint. Rebuild the supported
  // single-image shape instead of cloning the read response wholesale.
  const replacementLinkData: MetaObject = {
    link,
    image_hash: hash
  };
  for (const key of ["message", "name", "description"] as const) {
    const text = String(linkData[key] || "");
    if (text) replacementLinkData[key] = text;
  }

  const callToAction = metaObject(linkData.call_to_action);
  const callToActionType = String(callToAction.type || "").trim();
  if (callToActionType) {
    const sourceValue = metaObject(callToAction.value);
    const callToActionValue: MetaObject = { link };
    const leadFormId = String(sourceValue.lead_gen_form_id || "").trim();
    if (leadFormId) callToActionValue.lead_gen_form_id = leadFormId;
    replacementLinkData.call_to_action = {
      type: callToActionType,
      value: callToActionValue
    };
  }

  const replacement: MetaObject = {
    page_id: pageId,
    link_data: replacementLinkData
  };
  const instagramUserId = String(source.instagram_user_id || "").trim();
  if (/^\d{5,30}$/.test(instagramUserId)) replacement.instagram_user_id = instagramUserId;
  return replacement;
}

export function hasMetaPageAdvertiseTask(value: unknown) {
  const tasks = Array.isArray(value) ? value.map((task) => String(task || "").toUpperCase()) : [];
  return tasks.includes("ADVERTISE") || tasks.includes("MANAGE");
}

const META_PAGE_ADVERTISE_BLOCKER = "The connected Meta user has Lead access only for the DropX Page. In Meta Business Settings, grant Advertise or Full control Page access, then reopen this preview.";

async function metaPageAdvertiseBlocker(connection: Awaited<ReturnType<typeof metaConnection>>) {
  try {
    const accounts = await graphGet(connection, "me/accounts", {
      fields: "id,tasks",
      limit: "200"
    });
    const pages = Array.isArray(accounts.data) ? accounts.data as Array<Record<string, unknown>> : [];
    const page = pages.find((item) => String(item.id || "") === connection.pageId);
    if (!page) return null;
    const tasks = Array.isArray(page.tasks) ? page.tasks : [];
    if (tasks.length && !hasMetaPageAdvertiseTask(tasks)) return META_PAGE_ADVERTISE_BLOCKER;
  } catch {
    // Some system-user tokens cannot enumerate assigned Pages. Meta remains
    // the final authority during creative validation for those connections.
  }
  return null;
}

function replacementContext(payload: MetaGraphPayload): MetaAdCreativeReplacementContext {
  const creative = metaObject(payload.creative);
  const story = metaObject(creative.object_story_spec);
  const linkData = metaObject(story.link_data);
  const callToAction = metaObject(linkData.call_to_action);
  let replacementBlocker: string | null = null;
  if (!String(creative.id || "")) replacementBlocker = "Meta did not return the current creative ID.";
  else if (Object.keys(metaObject(creative.asset_feed_spec)).length) replacementBlocker = "Dynamic multi-asset creatives cannot be replaced with one poster.";
  else if (!Object.keys(linkData).length) replacementBlocker = "Only single-image link and lead creatives can be replaced.";
  else if (Array.isArray(linkData.child_attachments) && linkData.child_attachments.length) replacementBlocker = "Carousel creatives cannot be replaced with a single poster.";
  return {
    adId: String(payload.id || ""),
    adName: String(payload.name || "Unnamed ad"),
    configuredStatus: String(payload.configured_status || payload.status || "UNKNOWN").toUpperCase(),
    effectiveStatus: String(payload.effective_status || payload.status || "UNKNOWN").toUpperCase(),
    creativeId: String(creative.id || ""),
    creativeName: String(creative.name || "Current creative"),
    posterUrl: safeMetaImageUrl(creative.image_url)
      || safeMetaImageUrl(creative.thumbnail_url)
      || safeMetaImageUrl(linkData.picture),
    primaryText: String(linkData.message || ""),
    headline: String(linkData.name || ""),
    description: String(linkData.description || ""),
    callToAction: String(callToAction.type || "APPLY_NOW"),
    replaceable: !replacementBlocker,
    replacementBlocker,
    objectStorySpec: story
  };
}

export async function getMetaAdCreativeReplacementContext(metaAdId: string) {
  const adId = requireMetaObjectId(metaAdId, "Meta Ad ID");
  const connection = await metaConnection();
  const payload = await graphGet(connection, adId, {
    fields: "id,name,status,configured_status,effective_status,creative{id,name,image_url,thumbnail_url,object_story_spec,asset_feed_spec}"
  });
  const context = replacementContext(payload);
  if (context.replaceable) {
    const permissionBlocker = await metaPageAdvertiseBlocker(connection);
    if (permissionBlocker) {
      context.replaceable = false;
      context.replacementBlocker = permissionBlocker;
    }
  }
  return context;
}

export async function replaceMetaAdCreative(input: {
  metaAdId: string;
  expectedCreativeId: string;
  imageHash: string;
}) {
  const adId = requireMetaObjectId(input.metaAdId, "Meta Ad ID");
  const expectedCreativeId = requireMetaObjectId(input.expectedCreativeId, "Current creative ID");
  const connection = await metaConnection();
  const beforePayload = await graphGet(connection, adId, {
    fields: "id,name,status,configured_status,effective_status,creative{id,name,image_url,thumbnail_url,object_story_spec,asset_feed_spec}"
  });
  const before = replacementContext(beforePayload);
  const permissionBlocker = before.replaceable
    ? await metaPageAdvertiseBlocker(connection)
    : null;
  if (permissionBlocker) {
    before.replaceable = false;
    before.replacementBlocker = permissionBlocker;
  }
  if (!before.replaceable) throw new Error(before.replacementBlocker || "This creative cannot be replaced.");
  if (before.creativeId !== expectedCreativeId) {
    throw new Error("The creative changed after this preview opened. Close it and review the latest creative before replacing it.");
  }

  const objectStorySpec = buildReplacementObjectStorySpec(before.objectStorySpec, input.imageHash);
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const creativeName = `${before.creativeName || before.adName} · poster ${timestamp}`.slice(0, 240);
  const created = await graphRequest(
    connection,
    `act_${connection.accountId}/adcreatives`,
    "POST",
    { name: creativeName, object_story_spec: JSON.stringify(objectStorySpec) }
  );
  const replacementCreativeId = requireMetaObjectId(String(created.id || ""), "Replacement creative ID");
  const updated = await graphRequest(connection, adId, "POST", {
    creative: JSON.stringify({ creative_id: replacementCreativeId })
  });
  const afterPayload = await graphGet(connection, adId, {
    fields: "id,name,status,configured_status,effective_status,creative{id,name,image_url,thumbnail_url,object_story_spec,asset_feed_spec}"
  });
  const after = replacementContext(afterPayload);
  if (after.creativeId !== replacementCreativeId) {
    throw new Error("Meta accepted the replacement but did not attach it to the ad. No local change was saved.");
  }
  return {
    before,
    after,
    replacementCreativeId,
    metaResponse: { creative: created, ad: updated }
  };
}

async function resolveMetaPage(connection: Awaited<ReturnType<typeof metaConnection>>) {
  if (connection.pageAccessToken) {
    const page = await graphGet(connection, connection.pageId, { fields: "id,name" }, connection.pageAccessToken);
    return { page, accessToken: connection.pageAccessToken };
  }

  let directPage: MetaGraphPayload | null = null;
  try {
    directPage = await graphGet(connection, connection.pageId, { fields: "id,name,access_token" });
    const derived = String(directPage.access_token || "").trim();
    if (derived) return { page: directPage, accessToken: derived };
  } catch {
    // Some System User tokens cannot expose a Page token directly; try assigned accounts next.
  }

  try {
    const accounts = await graphGet(connection, "me/accounts", {
      fields: "id,name,access_token",
      limit: "200"
    });
    const pages = Array.isArray(accounts.data) ? accounts.data as Array<Record<string, unknown>> : [];
    const page = pages.find((item) => String(item.id || "") === connection.pageId);
    const derived = String(page?.access_token || "").trim();
    if (page && derived) return { page: page as MetaGraphPayload, accessToken: derived };
  } catch {
    // The explicit Page token field below remains the supported fallback.
  }

  const page = directPage || await graphGet(connection, connection.pageId, { fields: "id,name" });
  return { page, accessToken: connection.accessToken };
}

export async function getMetaAdBuilderCatalog(): Promise<MetaAdBuilderCatalog> {
  const connection = await metaConnection();
  const [account, pageContext, campaignsPayload] = await Promise.all([
    graphGet(connection, `act_${connection.accountId}`, { fields: "id,name,currency" }),
    resolveMetaPage(connection),
    graphGet(connection, `act_${connection.accountId}/campaigns`, {
      fields: "id,name,status,effective_status,objective,special_ad_categories",
      limit: "200"
    })
  ]);
  let formsPayload: MetaGraphPayload;
  try {
    formsPayload = await graphGet(connection, `${connection.pageId}/leadgen_forms`, {
      fields: "id,name,status,created_time",
      limit: "200"
    }, pageContext.accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta lead forms are unavailable.";
    if (/page access token|method must be called with a page access token/i.test(message)) {
      throw new Error("Meta ad creation needs a Page access token. Add it once under Connections → Meta Lead Ads → Advanced settings.");
    }
    throw error;
  }
  const page = pageContext.page;
  const forms = Array.isArray(formsPayload.data) ? formsPayload.data as Array<Record<string, unknown>> : [];
  const campaigns = Array.isArray(campaignsPayload.data) ? campaignsPayload.data as Array<Record<string, unknown>> : [];
  return {
    connected: true,
    accountId: String(account.id || `act_${connection.accountId}`),
    accountName: String(account.name || "Meta Ad Account"),
    currency: String(account.currency || "INR"),
    pageId: String(page.id || connection.pageId),
    pageName: String(page.name || "Meta Page"),
    forms: forms.map((item) => ({
      id: String(item.id || ""),
      name: String(item.name || "Unnamed form"),
      status: String(item.status || "UNKNOWN"),
      createdTime: item.created_time ? String(item.created_time) : null
    })).filter((item) => item.id).sort((left, right) => {
      const statusOrder = Number(right.status === "ACTIVE") - Number(left.status === "ACTIVE");
      return statusOrder || left.name.localeCompare(right.name);
    }),
    campaigns: campaigns.map((item) => ({
      id: String(item.id || ""),
      name: String(item.name || "Unnamed campaign"),
      status: String(item.status || "UNKNOWN"),
      effectiveStatus: String(item.effective_status || item.status || "UNKNOWN"),
      objective: String(item.objective || ""),
      specialAdCategories: Array.isArray(item.special_ad_categories)
        ? item.special_ad_categories.map(String)
        : []
    })).filter((item) => item.id && item.objective === "OUTCOME_LEADS"
      && item.specialAdCategories.includes("EMPLOYMENT"))
      .sort((left, right) => left.name.localeCompare(right.name))
  };
}

export async function publishMetaRecruitmentAd(input: {
  draft: MetaAdDraft;
  progress?: MetaPublishProgress;
  onProgress?: (progress: MetaPublishProgress) => Promise<void>;
}) {
  const draft = validateMetaAdDraft(input.draft);
  const connection = await metaConnection();
  const progress: MetaPublishProgress = { ...(input.progress ?? {}) };
  const saveProgress = async () => {
    if (input.onProgress) await input.onProgress({ ...progress });
  };

  if (!progress.campaignId) {
    if (draft.campaignMode === "existing") {
      const selected = await graphGet(connection, String(draft.campaignId), {
        fields: "id,objective,special_ad_categories"
      });
      const categories = Array.isArray(selected.special_ad_categories)
        ? selected.special_ad_categories.map(String)
        : [];
      if (String(selected.objective || "") !== "OUTCOME_LEADS" || !categories.includes("EMPLOYMENT")) {
        throw new Error("The selected campaign must use the Leads objective and Employment special ad category.");
      }
      progress.campaignId = String(selected.id || draft.campaignId);
    } else {
      const campaign = await graphRequest(
        connection,
        `act_${connection.accountId}/campaigns`,
        "POST",
        buildEmploymentCampaignValues(String(draft.campaignName))
      );
      progress.campaignId = String(campaign.id || "");
      if (!progress.campaignId) throw new Error("Meta did not return the new campaign ID.");
    }
    await saveProgress();
  }

  if (!progress.adSetId) {
    // Confirm the campaign-level budget-sharing choice immediately before
    // ad-set creation. This also repairs idempotent retries where an older
    // attempt saved campaignId and then failed with Meta 100/4834011.
    await graphRequest(
      connection,
      progress.campaignId,
      "POST",
      buildAdSetBudgetCampaignValues()
    );
    const adSet = await graphRequest(
      connection,
      `act_${connection.accountId}/adsets`,
      "POST",
      buildEmploymentAdSetValues({
        name: draft.adSetName,
        campaignId: progress.campaignId,
        dailyBudget: draft.dailyBudget,
        pageId: connection.pageId,
        daysRequired: draft.daysRequired,
        audience: draft.audience
      })
    );
    progress.adSetId = String(adSet.id || "");
    if (!progress.adSetId) throw new Error("Meta did not return the new ad set ID.");
    await saveProgress();
  }

  if (!progress.creativeId) {
    const creative = await graphRequest(
      connection,
      `act_${connection.accountId}/adcreatives`,
      "POST",
      {
        name: draft.creativeName,
        object_story_spec: JSON.stringify({
          page_id: connection.pageId,
          link_data: {
            link: draft.destinationUrl,
            ...(draft.imageHash ? { image_hash: draft.imageHash } : { picture: draft.posterUrl }),
            message: draft.primaryText,
            name: draft.headline,
            description: draft.description || undefined,
            call_to_action: {
              type: draft.callToAction,
              value: {
                link: draft.destinationUrl,
                lead_gen_form_id: draft.formId
              }
            }
          }
        })
      }
    );
    progress.creativeId = String(creative.id || "");
    if (!progress.creativeId) throw new Error("Meta did not return the new creative ID.");
    await saveProgress();
  }

  if (!progress.adId) {
    const ad = await graphRequest(
      connection,
      `act_${connection.accountId}/ads`,
      "POST",
      {
        name: draft.adName,
        adset_id: progress.adSetId,
        creative: JSON.stringify({ creative_id: progress.creativeId }),
        status: "PAUSED"
      }
    );
    progress.adId = String(ad.id || "");
    if (!progress.adId) throw new Error("Meta did not return the new ad ID.");
    await saveProgress();
  }

  return { draft, progress, pageId: connection.pageId, accountId: connection.accountId };
}
