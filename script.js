const paths = {
  house: "M3 10 12 3l9 7M5 9v12h14V9M9 21v-8h6v8",
  compass: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M16 8l-3 5-5 3 3-5 5-3",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8",
  message: "M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  shield: "M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6l-9-4M8 12l3 3 5-6",
  wallet: "M20 7H4V4h14v3M4 7v14h17V7M21 12h-7v5h7",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01",
  building: "M4 22V3h12v19M16 10h5v12M8 7h4M8 11h4M8 15h4M9 22v-3h3v3",
  bed: "M3 18V6M3 14h18v7M3 18h18M7 14V9h5v5M12 14V9h8v5",
  door: "M5 22V2h14v20M2 22h20M15 12h.01",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  wifi: "M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01",
  bath: "M3 12h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM5 12V5a3 3 0 0 1 6 0M6 22v-2M18 22v-2",
  snow: "M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3",
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.house}"/></svg>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) => "₱" + Number(n).toLocaleString("en-PH");
const categories = [
  ["", "All spaces", "grid"],
  ["Apartment", "Apartments", "building"],
  ["Bed spacer", "Bed spacers", "bed"],
  ["Boarding house", "Boarding houses", "house"],
  ["Room for rent", "Rooms for rent", "door"],
  ["Other spaces", "Other spaces", "grid"],
];
const allAmenities = [
  "Wi-Fi",
  "Air conditioning",
  "Parking",
  "Kitchen",
  "Laundry",
  "Pet friendly",
];
let rentals = [],
  saved = new Set(),
  user = null,
  page = "browse",
  category = "",
  query = "",
  budget = Infinity,
  managed = [],
  conversations = [];
let toastTimer,
  navigationVersion = 0;
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch("/api" + path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error(
      "Cannot connect to Roomify. Check your connection and try again.",
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || "Request failed. Please try again.");
  return data;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 5000);
}
function modal(content) {
  $("#modal-content").innerHTML =
    content + '<p id="form-error" class="form-error" role="alert"></p>';
  const title = $("#modal-content h2");
  if (title) title.id = "dialog-title";
  if (!$("#modal").open) $("#modal").showModal();
}
function accountUI() {
  $("#login").hidden = !!user;
  $("#signup").hidden = !!user;
  $("#logout").hidden = !user;
  $("#account-name").hidden = !user;
  $("#account-name").textContent = user ? `${user.name} · ${user.role}` : "";
  $("#owner-nav").hidden = user?.role !== "owner";
  $("#admin-nav").hidden = user?.role !== "admin";
}
async function refresh() {
  rentals = (await api("/listings")).listings;
  saved = user ? new Set((await api("/favorites")).ids) : new Set();
  render();
}
function render() {
  $("#categories").innerHTML = categories
    .map(
      ([value, label, i]) =>
        `<button class="category ${category === value ? "active" : ""}" data-category="${value}" aria-pressed="${category === value}">${icon(i)}${label}</button>`,
    )
    .join("");
  $("#saved-count").textContent = saved.size;
  const amenities = [
    ...document.querySelectorAll(".filters input:checked"),
  ].map((el) => el.value);
  const max =
    Number($("#price").value) === 50000 ? Infinity : Number($("#price").value);
  let items = rentals.filter(
    (p) =>
      (page !== "saved" || saved.has(p.id)) &&
      (!category || p.type === category) &&
      (!query ||
        `${p.city} ${p.address} ${p.title}`.toLowerCase().includes(query)) &&
      p.price <= Math.min(budget, max) &&
      amenities.every((a) => p.amenities.includes(a)),
  );
  if ($("#sort").value === "low") items.sort((a, b) => a.price - b.price);
  if ($("#sort").value === "high") items.sort((a, b) => b.price - a.price);
  $("#results-count").innerHTML =
    `<strong>${items.length} ${items.length === 1 ? "place" : "places"}</strong> ${page === "saved" ? "saved for later" : "to call your own"}`;
  $("#listings").innerHTML = items.length
    ? items.map(card).join("")
    : `<div class="empty">${icon(page === "saved" ? "heart" : "search")}<h3>${page === "saved" ? "Your next home could be a heart away" : "No spaces found just yet"}</h3><p>${page === "saved" ? "Save properties you like to keep them together here." : "Try adjusting your filters. Owners can submit the first listing."}</p><button class="primary" id="empty-reset">${page === "saved" ? "Explore rentals" : "Clear filters"}</button></div>`;
}
function card(p) {
  return `<article class="property"><div class="property-photo"><a href="#property-${p.id}" data-details="${p.id}" aria-label="View ${esc(p.title)}"><img src="${esc(p.photos[0])}" alt="${esc(p.title)}" loading="lazy"></a><span class="tag ${p.sample ? "" : "featured"}">${p.sample ? "Sample listing" : "Available"}</span><button class="save ${saved.has(p.id) ? "saved" : ""}" data-save="${p.id}" aria-label="${saved.has(p.id) ? "Unsave" : "Save"} ${esc(p.title)}" aria-pressed="${saved.has(p.id)}">${icon("heart")}</button></div><div class="property-body"><span class="property-type">${esc(p.type)}</span><h3><a href="#property-${p.id}" data-details="${p.id}">${esc(p.title)}</a></h3><p class="location">${icon("pin")}${esc(p.city)}</p><div class="amenities"><span>${icon("bed")}${esc(p.beds)}</span><span>${icon("bath")}${esc(p.bath)}</span>${p.amenities.includes("Wi-Fi") ? `<span>${icon("wifi")}Wi-Fi</span>` : ""}</div><div class="property-bottom"><span class="price">${money(p.price)}<small> / month</small></span><a class="details-link" href="#property-${p.id}" data-details="${p.id}">View details <span>↗</span></a></div></div></article>`;
}
function reset() {
  $("#search-form").reset();
  $("#price").value = 50000;
  $("#price-value").textContent = "Any price";
  document
    .querySelectorAll(".filters input[type=checkbox]")
    .forEach((el) => (el.checked = false));
  query = "";
  category = "";
  budget = Infinity;
  render();
}
async function navigate(value) {
  if (value !== "browse" && !user) return auth("login");
  const version = ++navigationVersion;
  page = value;
  const browsing = ["browse", "saved"].includes(value);
  $("#browse-view").hidden = !browsing;
  $("#dashboard").hidden = browsing;
  const labels = {
    browse: "Explore rentals",
    saved: "Saved properties",
    owner: "My listings",
    admin: "Admin review",
    inquiries: "My inquiries",
  };
  $("#crumb").textContent = labels[value];
  document
    .querySelectorAll("[data-page]")
    .forEach((el) => el.classList.toggle("active", el.dataset.page === value));
  if (browsing) {
    $("#page-title").textContent =
      value === "saved"
        ? "Spaces you’ve got your eye on"
        : "A place for every lifestyle";
    $("#page-subtitle").textContent =
      value === "saved"
        ? "Your favorites, all in one place."
        : "A little browsing, a big new beginning.";
    reset();
    await refresh();
    if (value === "saved") $(".explore").scrollIntoView({ behavior: "smooth" });
  } else {
    $("#dashboard").innerHTML = '<p role="status">Loading your workspace…</p>';
    try {
      if (value === "inquiries") {
        const result = await api("/inquiries");
        if (version !== navigationVersion) return;
        conversations = result.inquiries;
        renderInquiries();
      } else {
        const result = await api("/listings?scope=" + value);
        if (version !== navigationVersion) return;
        managed = result.listings;
        renderManaged();
      }
    } catch (error) {
      if (version === navigationVersion)
        $("#dashboard").innerHTML =
          `<div class="empty"><h2>Unable to load this page</h2><p>${esc(error.message)}</p><button class="primary" data-page="${value}">Try again</button></div>`;
    }
  }
}
function auth(mode = "login", role = "renter") {
  const register = mode === "register";
  modal(
    `<span class="property-type">WELCOME TO ROOMIFY</span><h2>${register ? "Your next chapter starts here." : "Welcome home."}</h2><p>${register ? "Create an account to find a space or share yours." : "Log in to manage your spaces, favorites, and conversations."}</p><form class="form-stack" id="auth-form" data-mode="${mode}">${register ? '<label>Your name<input name="name" required maxlength="100" autocomplete="name"></label>' : ""}<label>Email address<input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>Password<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="${register ? "new-password" : "current-password"}"></label>${register ? `<label>I want to<select name="role"><option value="renter" ${role === "renter" ? "selected" : ""}>Find a rental</option><option value="owner" ${role === "owner" ? "selected" : ""}>List my property</option></select></label><small>Use at least 10 characters for your password.</small>` : ""}<button class="primary">${register ? "Create account" : "Log in"}</button></form><button class="switch-auth" data-auth="${register ? "login" : "register"}">${register ? "Already have an account? Log in" : "New here? Create an account"}</button>`,
  );
}
async function details(id) {
  const { listing: p } = await api("/listings/" + id);
  if (page === "admin")
    managed = managed.map((item) => (item.id === p.id ? p : item));
  modal(
    `<img class="modal-photo" id="gallery-main" src="${esc(p.photos[0])}" alt="${esc(p.title)}"><div class="gallery">${p.photos.map((src, i) => `<button data-photo="${esc(src)}" aria-label="Show photo ${i + 1}"><img src="${esc(src)}" alt="Photo ${i + 1}"></button>`).join("")}</div><span class="property-type">${esc(p.type)} · ${p.sample ? "Sample listing" : esc(p.status)}</span><h2>${esc(p.title)}</h2><p>${esc(p.city)} · ${esc(p.beds)} · ${esc(p.bath)}</p><span class="price">${money(p.price)}<small> / month</small></span><p class="preserve-lines">${esc(p.description)}</p><p><strong>Address</strong><br>${esc(p.address)}</p><div class="modal-tags">${p.amenities.map((a) => `<span>${esc(a)}</span>`).join("")}</div><div class="contact-panel"><strong>${esc(p.owner)}</strong><p>${esc(p.contact)}</p></div>${p.sample ? "<p>This fictional listing uses an illustrative photo and does not accept inquiries.</p>" : `<button class="primary" data-inquire="${p.id}">${icon("message")}Send an inquiry</button>`}${page === "admin" && !p.sample ? `<div class="action-row"><button class="primary" data-review="${p.id}" data-decision="approved">Approve listing</button><button class="secondary" data-review="${p.id}" data-decision="rejected">Reject listing</button></div>` : ""}`,
  );
}
function renderManaged() {
  const admin = page === "admin",
    items = managed.filter((p) => !p.sample);
  $("#dashboard").innerHTML =
    `<div class="dashboard-heading"><div><span class="eyebrow">${admin ? "ROOMIFY ADMINISTRATION" : "YOUR OWNER WORKSPACE"}</span><h1>${admin ? "Good spaces start with a review." : "Make room for someone new."}</h1><p>${admin ? "Review property information and photos before publishing." : "Manage your properties, availability, and listing updates."}</p></div>${admin ? "" : '<button class="primary" data-owner>Add a property +</button>'}</div><div class="stats"><div><strong>${items.length}</strong><span>Total listings</span></div><div><strong>${items.filter((p) => p.status === "pending").length}</strong><span>Awaiting review</span></div><div><strong>${items.filter((p) => p.status === "approved" && p.available).length}</strong><span>Published & available</span></div></div><div class="manage-list">${items.length ? items.map((p) => `<article class="manage-card"><img src="${esc(p.photos[0])}" alt="${esc(p.title)}"><div class="manage-info"><span class="status ${esc(p.status)}">${esc(p.status)}${p.available ? "" : " · unavailable"}</span><h3>${esc(p.title)}</h3><p>${esc(p.city)} · ${money(p.price)}/month${admin ? " · " + esc(p.owner) : ""}</p>${p.review_note ? `<p class="review-note">Admin note: ${esc(p.review_note)}</p>` : ""}<div class="action-row"><button class="secondary" data-details="${p.id}">View details</button>${admin ? `<button class="primary" data-review="${p.id}" data-decision="approved">Approve</button><button class="secondary" data-review="${p.id}" data-decision="rejected">Reject</button>` : `<button class="secondary" data-edit="${p.id}">Edit</button><button class="secondary" data-availability="${p.id}">${p.available ? "Mark unavailable" : "Mark available"}</button><button class="danger" data-delete="${p.id}">Delete</button>`}</div></div></article>`).join("") : `<div class="empty"><h3>No listings yet</h3><p>${admin ? "New owner submissions will appear here." : "Add your first property to submit it for admin review."}</p></div>`}</div>`;
}
function ownerForm(id) {
  if (!user) return auth("register", "owner");
  if (user.role !== "owner")
    return modal(
      "<h2>A space for property owners.</h2><p>Listing properties requires an owner account. Log out and sign in with an owner account to continue.</p>",
    );
  const p = managed.find((item) => item.id === id);
  if (id && !p) throw new Error("Reopen My listings before editing.");
  modal(
    `<h2>${p ? "Update your space." : "Share your space."}</h2><p>${p ? "Changes return this listing to admin review." : "Your property will appear in search once an admin approves it."}</p><form class="form-stack" id="owner-form" data-id="${p?.id || ""}" data-version="${p?.version || ""}"><label>Property name<input name="title" required maxlength="100" value="${esc(p?.title)}"></label><div class="form-columns"><label>Property type<select name="type">${categories
      .slice(1)
      .map(
        ([value]) =>
          `<option ${p?.type === value ? "selected" : ""}>${value}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Monthly rent (₱)<input name="price" type="number" min="1" max="1000000" step="1" required value="${p?.price || ""}"></label></div><label>City / municipality<input name="city" required maxlength="100" placeholder="Calamba, Laguna" value="${esc(p?.city)}"></label><label>Address / neighborhood<input name="address" required maxlength="200" value="${esc(p?.address)}"></label><div class="form-columns"><label>Bedrooms / bed spaces<input name="beds" required maxlength="60" placeholder="1 bedroom" value="${esc(p?.beds)}"></label><label>Bathrooms<input name="bath" required maxlength="60" placeholder="1 shared bathroom" value="${esc(p?.bath)}"></label></div><label>Description<textarea name="description" required minlength="20" maxlength="4000">${esc(p?.description)}</textarea></label><label>Public contact information<input name="contact" required maxlength="200" placeholder="Email or phone renters can use to reach you" value="${esc(p?.contact)}"></label><small>This contact information and address will be visible on approved listings.</small><fieldset><legend>Amenities</legend><div class="amenity-options">${allAmenities.map((a) => `<label><input type="checkbox" name="amenities" value="${a}" ${p?.amenities.includes(a) ? "checked" : ""}>${a}</label>`).join("")}</div></fieldset>${p ? `<fieldset><legend>Existing photos — uncheck to remove</legend><div class="existing-photos">${p.photos.map((src) => `<label><img src="${esc(src)}" alt="Property photo"><input type="checkbox" name="keepPhotos" value="${src.split("/").pop()}" checked> Keep photo</label>`).join("")}</div></fieldset>` : ""}<label>${p ? "Add photos" : "Property photos"}<input name="photos" type="file" accept="image/jpeg,image/png" multiple ${p ? "" : "required"}></label><small>1–4 photos in total. JPEG or PNG, up to 3 MB each.</small>${p ? `<label>Availability<select name="available"><option value="true" ${p.available ? "selected" : ""}>Available</option><option value="false" ${p.available ? "" : "selected"}>Unavailable</option></select></label>` : ""}<button class="primary">Submit for review</button></form>`,
  );
}
function reviewForm(id, decision) {
  const p = managed.find((item) => item.id === id);
  if (!p) throw new Error("Reload the dashboard before reviewing.");
  modal(
    `<h2>${decision === "approved" ? "Approve this property?" : "Request a listing update."}</h2><p>${esc(p.title)}${decision === "approved" ? " will be visible to renters when marked available." : ""}</p><form class="form-stack" id="review-form" data-id="${id}" data-version="${p.version}" data-decision="${decision}"><label>Note to the owner ${decision === "approved" ? "(optional)" : ""}<textarea name="note" maxlength="500" ${decision === "rejected" ? 'required minlength="5"' : ""}></textarea></label><button class="primary">${decision === "approved" ? "Approve listing" : "Reject with feedback"}</button></form>`,
  );
}
function renderInquiries() {
  $("#dashboard").innerHTML =
    `<div class="dashboard-heading"><div><span class="eyebrow">A CONVERSATION CAN OPEN A DOOR</span><h1>My inquiries</h1><p>Messages and owner replies are delivered here inside Roomify.</p></div><button class="secondary" data-page="inquiries">Refresh messages</button></div><div class="conversation-list">${conversations.length ? conversations.map((i) => `<article class="conversation"><div class="conversation-heading"><div><h3>${esc(i.title)}</h3><p>${esc(i.city)} · ${esc(user.id === i.owner_id ? i.renter_name : i.owner_name)}</p></div><span class="status ${i.reply ? "approved" : "pending"}">${i.reply ? "Replied" : "Awaiting reply"}</span></div><small>${esc(i.created_at)} UTC</small><p class="message preserve-lines">${esc(i.message)}</p>${i.reply ? `<div class="reply"><strong>Owner’s reply</strong><p class="preserve-lines">${esc(i.reply)}</p><small>${esc(i.replied_at)} UTC</small></div>` : ""}${user.id === i.owner_id ? `<button class="primary" data-reply="${i.id}">${i.reply ? "Update reply" : "Reply to inquiry"}</button>` : ""}</article>`).join("") : `<div class="empty"><h3>No conversations yet</h3><p>${user.role === "owner" ? "Inquiries about your published listings will appear here." : "Find a property you like and send the owner an inquiry."}</p></div>`}</div>`;
}
async function inquiryForm(id) {
  if (!user) return auth("login");
  if (user.role !== "renter")
    return modal(
      "<h2>Inquiries are for renters.</h2><p>Use a renter account to contact a property owner. Owners can reply to messages from My inquiries.</p>",
    );
  const { listing: p } = await api("/listings/" + id);
  modal(
    `<h2>Say hello to ${esc(p.owner)}</h2><p>Ask about ${esc(p.title)}. The owner will receive your message in Roomify.</p><form class="form-stack" id="inquiry-form" data-id="${id}"><label>Your message<textarea name="message" required minlength="5" maxlength="2000">Hi, is this space still available? I’d love to know more.</textarea></label><button class="primary">Send inquiry</button></form>`,
  );
}
function help() {
  modal(
    "<h2>A little help finding your place.</h2><p><strong>Renters</strong><br>Search and filter available spaces. Create a renter account to save favorites and send inquiries. Read replies in My inquiries.</p><p><strong>Owners</strong><br>Create an owner account, add your property with photos, and submit it for admin review. Manage availability and reply to renters from your workspace.</p><p><strong>Listings</strong><br>New and edited properties require approval before appearing in search. Listings marked “Sample listing” are fictional and do not accept inquiries.</p>",
  );
}
async function readPhoto(file) {
  if (
    !["image/jpeg", "image/png"].includes(file.type) ||
    file.size > 3 * 1024 * 1024
  )
    throw new Error("Choose JPEG or PNG photos, up to 3 MB each.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read photo."));
    reader.readAsDataURL(file);
  });
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button, a");
  if (!b || b.disabled) return;
  try {
    if (b.dataset.page) return await navigate(b.dataset.page);
    if (b.hasAttribute("data-category")) {
      category = b.dataset.category;
      $("#search-type").value = category;
      return render();
    }
    if (b.dataset.details) {
      e.preventDefault();
      return await details(Number(b.dataset.details));
    }
    if (b.dataset.save) {
      if (!user) return auth("login");
      b.disabled = true;
      const id = Number(b.dataset.save),
        wasSaved = saved.has(id);
      await api("/favorites/" + id, { method: wasSaved ? "DELETE" : "PUT" });
      wasSaved ? saved.delete(id) : saved.add(id);
      return render();
    }
    if (b.dataset.auth) return auth(b.dataset.auth);
    if (b.hasAttribute("data-owner")) return ownerForm();
    if (b.dataset.edit) return ownerForm(Number(b.dataset.edit));
    if (b.dataset.inquire) return await inquiryForm(Number(b.dataset.inquire));
    if (b.dataset.photo) {
      $("#gallery-main").src = b.dataset.photo;
      return;
    }
    if (b.dataset.review)
      return reviewForm(Number(b.dataset.review), b.dataset.decision);
    if (b.dataset.availability) {
      const p = managed.find((p) => p.id === Number(b.dataset.availability));
      b.disabled = true;
      await api("/listings/" + p.id + "/availability", {
        method: "PATCH",
        body: { available: !p.available },
      });
      await navigate("owner");
      return toast("Availability updated.");
    }
    if (b.dataset.delete) {
      const p = managed.find((p) => p.id === Number(b.dataset.delete));
      return modal(
        `<h2>Delete this property?</h2><p>${esc(p.title)} and its photos, saved entries, and inquiries will be permanently removed.</p><form class="form-stack" id="delete-form" data-id="${p.id}"><button class="danger">Delete property permanently</button></form>`,
      );
    }
    if (b.dataset.reply) {
      const i = conversations.find((i) => i.id === Number(b.dataset.reply));
      return modal(
        `<h2>Reply to ${esc(i.renter_name)}</h2><p>${esc(i.title)}</p><form class="form-stack" id="reply-form" data-id="${i.id}"><label>Your reply<textarea name="reply" required minlength="5" maxlength="2000">${esc(i.reply)}</textarea></label><button class="primary">Send reply</button></form>`,
      );
    }
    if (b.id === "login") return auth();
    if (b.id === "signup") return auth("register");
    if (b.id === "logout") {
      await api("/logout", { method: "POST" });
      user = null;
      accountUI();
      await navigate("browse");
      return toast("You are logged out.");
    }
    if (["help", "footer-help"].includes(b.id)) return help();
    if (b.id === "empty-reset")
      return page === "saved" ? await navigate("browse") : reset();
    if (b.id === "reload-app") return await start();
  } catch (error) {
    toast(error.message);
  } finally {
    if (b.isConnected) b.disabled = false;
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (form.id === "search-form") {
    e.preventDefault();
    query = $("#location").value.trim().toLowerCase();
    category = $("#search-type").value;
    budget = Number($("#budget").value) || Infinity;
    render();
    $(".explore").scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (!form.closest("#modal")) return;
  e.preventDefault();
  const button = form.querySelector("button[type=submit],button:not([type])");
  button.disabled = true;
  $("#form-error").textContent = "";
  const data = new FormData(form);
  try {
    if (form.id === "auth-form") {
      const result = await api(
        form.dataset.mode === "register" ? "/register" : "/login",
        { method: "POST", body: Object.fromEntries(data) },
      );
      user = result.user;
      accountUI();
      $("#modal").close();
      await navigate(
        user.role === "owner"
          ? "owner"
          : user.role === "admin"
            ? "admin"
            : "browse",
      );
      toast("Welcome, " + user.name + ".");
    } else if (form.id === "owner-form") {
      const files = [...form.elements.photos.files],
        kept = data.getAll("keepPhotos").map(Number);
      if (files.length + kept.length < 1 || files.length + kept.length > 4)
        throw new Error("Choose 1–4 photos in total.");
      const payload = {
        ...Object.fromEntries(data),
        price: Number(data.get("price")),
        amenities: data.getAll("amenities"),
        keepPhotos: kept,
        photos: await Promise.all(files.map(readPhoto)),
        available: data.get("available") !== "false",
        version: Number(form.dataset.version),
      };
      await api("/listings" + (form.dataset.id ? "/" + form.dataset.id : ""), {
        method: form.dataset.id ? "PUT" : "POST",
        body: payload,
      });
      $("#modal").close();
      await navigate("owner");
      toast("Property submitted for admin review.");
    } else if (form.id === "review-form") {
      await api("/listings/" + form.dataset.id + "/review", {
        method: "PATCH",
        body: {
          status: form.dataset.decision,
          note: data.get("note"),
          version: Number(form.dataset.version),
        },
      });
      $("#modal").close();
      await navigate("admin");
      toast("Review saved.");
    } else if (form.id === "delete-form") {
      await api("/listings/" + form.dataset.id, { method: "DELETE" });
      $("#modal").close();
      await navigate("owner");
      toast("Property deleted.");
    } else if (form.id === "inquiry-form") {
      await api("/inquiries", {
        method: "POST",
        body: {
          listingId: Number(form.dataset.id),
          message: data.get("message"),
        },
      });
      $("#modal").close();
      await navigate("inquiries");
      toast("Inquiry sent to the owner.");
    } else if (form.id === "reply-form") {
      await api("/inquiries/" + form.dataset.id + "/reply", {
        method: "PATCH",
        body: { reply: data.get("reply") },
      });
      $("#modal").close();
      await navigate("inquiries");
      toast("Reply sent.");
    }
  } catch (error) {
    if ($("#form-error")) $("#form-error").textContent = error.message;
    else toast(error.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});
$("#reset").onclick = reset;
$("#sort").onchange = render;
$(".filters").addEventListener("input", () => {
  $("#price-value").textContent =
    $("#price").value === "50000" ? "Any price" : money($("#price").value);
  render();
});
$(".close").onclick = () => $("#modal").close();
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) {
    const r = $("#modal").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      $("#modal").close();
  }
});
$("#toggle-filters").onclick = () => {
  const open = $(".filters").classList.toggle("mobile-open");
  $("#toggle-filters").setAttribute("aria-expanded", open);
  $("#toggle-filters").textContent = open ? "Hide filters −" : "Show filters +";
};
async function start() {
  try {
    user = (await api("/me")).user;
    accountUI();
    await refresh();
  } catch (error) {
    $("#listings").innerHTML =
      `<div class="empty"><h3>Unable to load properties</h3><p>${esc(error.message)}</p><button class="primary" id="reload-app">Try again</button></div>`;
  }
}
start();
