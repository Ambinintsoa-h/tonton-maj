export const exportAsText = (content) => {
  const div = document.createElement('div');
  div.innerHTML = content;
  // Remove deleted content spans
  div.querySelectorAll('.deleted-content').forEach(el => el.remove());
  // Replace updated spans with their text
  div.querySelectorAll('.updated-content').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent));
  });
  return div.textContent || div.innerText || '';
};

export const exportAsHtml = (content) => {
  const div = document.createElement('div');
  div.innerHTML = content;
  // Remove deleted content entirely
  div.querySelectorAll('.deleted-content, del').forEach(el => el.remove());
  // Unwrap updated content: keep inner HTML, discard the <mark> wrapper
  div.querySelectorAll('.updated-content, mark').forEach(el => {
    const frag = document.createDocumentFragment();
    while (el.firstChild) frag.appendChild(el.firstChild);
    if (el.parentNode) el.parentNode.replaceChild(frag, el);
  });
  // Filet de sécurité regex — élimine tout résidu <del>/<mark> non capturé par le DOM
  let html = div.innerHTML;
  html = html.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, '');
  let prev = '';
  while (prev !== html) {
    prev = html;
    html = html.replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, '$1');
  }
  return html;
};

export const exportAsMarkdown = (content) => {
  const html = exportAsHtml(content);
  // Basic HTML to Markdown conversion
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const copyToClipboard = async (text) => {
  await navigator.clipboard.writeText(text);
};
