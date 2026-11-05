const host = document.getElementById('staticComparison');
const ids = [...new Set((new URL(location.href).searchParams.get('ids') || '').split(',').map(s => s.trim().toLowerCase()))].filter(s => /^[a-z0-9-]+\/[a-z0-9_.-]+$/.test(s)).slice(0, 3);
const esc = text => String(text ?? '—').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
if (host && ids.length >= 2) {
  try {
    const response = await fetch('/assets/catalog-compare.json');
    if (!response.ok) throw new Error('Catalog unavailable');
    const catalog = await response.json();
    const projects = ids.map(id => catalog.find(p => p.repo.toLowerCase() === id)).filter(Boolean);
    if (projects.length < 2) throw new Error('Choose at least two listed projects.');
    const fields = [['Relationship to Jev', 'relationship'], ['Evidence', 'evidenceLevel'], ['License', 'license'], ['Language', 'language'], ['GitHub stars', 'stars'], ['Last code update', 'pushed']];
    host.innerHTML = `<div class="compare-scroll"><table class="compare-table"><thead><tr><th>Project</th>${projects.map(p => `<th><a href="${esc(p.detailPath || "/projects/" + p.repo.toLowerCase() + "/")}">${esc(p.name)}</a></th>`).join('')}</tr></thead><tbody>${fields.map(([label, key]) => `<tr><th scope="row">${label}</th>${projects.map(p => `<td>${esc(p[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  } catch (error) { host.textContent = error.message; }
}
