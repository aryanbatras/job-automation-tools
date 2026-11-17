# WhatsApp workflows

- `read-whatsapp-channel.js`: on an already-open WhatsApp Web channel, return up to 100 distinct visible messages and their links. It does not navigate, follow links, send messages, or write files.

Use it only after the user opens the specific channel. Job-related messages and links are returned for review; private channel contents must not be written into tracked files.
