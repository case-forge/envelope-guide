// Starts the shared pdf.js worker from inside this tool's own folder, so the offline service worker (scope
// /envelope-guide/) controls it and it starts with the network off. The library file itself is shared: /vendor/.
import '/vendor/pdfjs.worker.mjs';
