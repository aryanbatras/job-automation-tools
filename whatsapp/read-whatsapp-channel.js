async (page) => {
  const url = new URL(page.url());
  if (url.hostname !== 'web.whatsapp.com') {
    return { status: 'unsupported_page', messages: [], links: [] };
  }

  const rawMessages = await page.locator(
    'span.selectable-text, div.copyable-text, div[class*="message-in"] span',
  ).evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const message = (element.innerText || '').trim();
    return rect.width > 0 && rect.height > 0 && message ? [message] : [];
  }));

  const messages = [];
  const seenMessages = new Set();
  for (const message of rawMessages) {
    if (seenMessages.has(message)) continue;
    seenMessages.add(message);
    messages.push(message);
    if (messages.length === 100) break;
  }

  const links = [...new Set(messages.flatMap((message) =>
    message.match(/https?:\/\/[^\s<>]+/g) || [],
  ))];

  return { status: 'ok', count: messages.length, messages, links };
}
