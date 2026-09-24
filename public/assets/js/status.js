const time = document.getElementById("syncTime");
if (time?.dateTime && Date.now() - Date.parse(time.dateTime) > 24 * 3600_000) {
  document.getElementById("freshnessStatus").append(" — overdue; check the workflow history.");
}
