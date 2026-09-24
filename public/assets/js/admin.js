const host = document.getElementById("reviewQueue");
const status = document.getElementById("reviewStatus");
const note = document.getElementById("adminNote");
const more = document.getElementById("reviewMore");
let cursor = "", nextCursor = null, busy = false;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function load(append = false) {
  if (busy) return;
  busy = true; more.disabled = true;
  try {
    const response = await fetch("/api/admin/submissions?status=" + encodeURIComponent(status.value) + "&cursor=" + encodeURIComponent(cursor));
    if (!response.ok) throw new Error(response.status === 403 ? "Sign in with an authorized administrator account." : "Could not load submissions.");
    const data = await response.json(); nextCursor = data.nextCursor;
    if (!append) host.replaceChildren();
    for (const item of data.submissions) {
      const article = document.createElement("article"); article.className = "review-card";
      article.innerHTML = `<h2>${esc(item.name)}</h2><p><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.url)}</a></p><p>${esc(item.description)}</p><p data-review-status>Status: ${esc(item.status)}</p><form class="review-form">
      <label>Category<select name="category">${window.JH_REVIEW_CATEGORIES.map(c => `<option value="${esc(c.id)}" ${c.id === item.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label>Relationship to Jev<select name="relationship">${["jev-app","integration","sdk","local-alternative","research","resource"].map(value => `<option ${value === item.relationship ? "selected" : ""}>${value}</option>`).join("")}</select></label>
      <label>Source evidence at a fixed commit<input name="evidenceUrl" type="url" placeholder="https://github.com/owner/repo/blob/40-character-commit/file" value="${esc(item.evidence_url || "")}" maxlength="1000"/></label>
      <label>Review note (visible to the submitter)<textarea name="note" required minlength="5" maxlength="1000">${esc(item.review_note || "")}</textarea></label>
      <div class="review-actions"><button class="btn btn--primary" name="decision" value="approved">Approve for publication</button><button class="btn btn--ghost" name="decision" value="rejected">Reject / withdraw</button><button class="btn btn--ghost" name="decision" value="pending">Return to review</button></div><p role="status" class="review-result"></p></form>`;
      article.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget, output = form.querySelector(".review-result");
        const decision = event.submitter?.value;
        if (!decision) return;
        const data = Object.fromEntries(new FormData(form));
        const buttons = [...form.querySelectorAll("button")]; buttons.forEach(b => b.disabled = true);
        try {
          const response = await fetch("/api/admin/submissions", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, id: item.id, status: decision, expectedStatus: item.status }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error === "review_conflict" ? "Another review changed this entry. Reload the queue." : result.error);
          item.status = decision;
          article.querySelector("[data-review-status]").textContent = "Status: " + decision;
          output.textContent = decision === "approved" ? "Saved. Queued for verification and publication." : "Saved. Review state updated.";
        } catch (error) { output.textContent = error.message; }
        finally { buttons.forEach(b => b.disabled = false); }
      });
      host.append(article);
    }
    note.textContent = host.children.length ? "Review the source and select the correct relationship before approving." : "No submissions in this queue.";
    more.hidden = nextCursor === null;
  } catch (error) { note.textContent = error.message; more.hidden = true; }
  finally { busy = false; more.disabled = false; }
}
status.addEventListener("change", () => { cursor = ""; load(); });
more.addEventListener("click", () => { if (nextCursor !== null) { cursor = nextCursor; load(true); } });
load();

document.getElementById("triggerDiscovery")?.addEventListener("click", async event => {
  const button = event.currentTarget; button.disabled = true;
  try {
    const response = await fetch("/api/admin/sync", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not queue discovery");
    note.textContent = "Discovery queued. Progress is available on the update status page.";
  } catch (error) { note.textContent = error.message; }
  finally { button.disabled = false; }
});
