// A publisher's document (PDF / JPG / PNG, up to 2 MB) -> { data: "data:...;base64,...", name }
// for the JSON body. Used by the publisher's form and the admin page (server/publishers.js checks it again).
export const DOC_MAX = 2 * 1024 * 1024;
export const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export function readDocument(file) {
  return new Promise((resolve, reject) => {
    if (!DOC_TYPES.includes(file.type)) return reject(new Error("The document must be a PDF, JPG or PNG."));
    if (file.size > DOC_MAX) return reject(new Error("The document can be up to 2 MB."));
    const r = new FileReader();
    r.onload = () => resolve({ data: r.result, name: file.name });
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}
