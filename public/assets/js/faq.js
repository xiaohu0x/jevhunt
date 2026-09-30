function revealAnswer() {
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  const answer = document.getElementById(id)?.closest("details[data-faq-answer]");
  if (answer) {
    answer.open = true;
    answer.scrollIntoView?.({ block: "start" });
  }
}
addEventListener("hashchange", revealAnswer);
revealAnswer();
