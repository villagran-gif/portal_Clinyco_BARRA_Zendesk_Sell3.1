const { Readable } = require('stream');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function driveFolderUrl(id) {
  return `https://drive.google.com/drive/folders/${id}`;
}
function driveFileUrl(id) {
  return `https://drive.google.com/file/d/${id}/view`;
}

function qEscape(str) {
  // Drive query uses single quotes
  return String(str || '').replace(/'/g, "\\'");
}

async function findChildFolderByName(drive, parentId, name) {
  const q = `mimeType='${FOLDER_MIME}' and trashed=false and name='${qEscape(name)}' and '${qEscape(parentId)}' in parents`;
  const res = await drive.files.list({
    q,
    fields: 'files(id,name)',
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = res?.data?.files || [];
  return files[0] || null;
}

async function ensureFolder(drive, parentId, name) {
  const hit = await findChildFolderByName(drive, parentId, name);
  if (hit?.id) return hit.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: 'id,name',
    supportsAllDrives: true,
  });
  return created?.data?.id;
}

async function ensurePatientFolderStructure({ drive, rootFolderId, patientFolderName }) {
  const patientFolderId = await ensureFolder(drive, rootFolderId, patientFolderName);
  const pdfFolderId = await ensureFolder(drive, patientFolderId, '00_PDF');
  const docsFolderId = await ensureFolder(drive, patientFolderId, '01_Docs_Generados');
  return { patientFolderId, pdfFolderId, docsFolderId };
}

async function replacePlaceholders({ docs, documentId, placeholders }) {
  const requests = Object.entries(placeholders || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ({
      replaceAllText: {
        containsText: { text: `{{${k}}}`, matchCase: true },
        replaceText: String(v),
      },
    }));

  if (!requests.length) return;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });
}

async function copyTemplateToFolder({ drive, templateFileId, newName, parentFolderId }) {
  const res = await drive.files.copy({
    fileId: templateFileId,
    requestBody: { name: newName, parents: [parentFolderId] },
    fields: 'id,name',
    supportsAllDrives: true,
  });
  return res?.data;
}

async function exportDocAsPdfBuffer({ drive, fileId }) {
  const res = await drive.files.export(
    { fileId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

async function uploadPdfToFolder({ drive, pdfBuffer, pdfName, parentFolderId }) {
  const res = await drive.files.create({
    requestBody: {
      name: pdfName,
      parents: [parentFolderId],
      mimeType: 'application/pdf',
    },
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(pdfBuffer),
    },
    fields: 'id,name',
    supportsAllDrives: true,
  });
  return res?.data;
}

async function generateDocAndPdf({
  drive,
  docs,
  templateFileId,
  docsFolderId,
  pdfFolderId,
  baseName,
  placeholders,
}) {
  const copied = await copyTemplateToFolder({
    drive,
    templateFileId,
    newName: baseName,
    parentFolderId: docsFolderId,
  });

  await replacePlaceholders({ docs, documentId: copied.id, placeholders });

  const pdfBuffer = await exportDocAsPdfBuffer({ drive, fileId: copied.id });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const pdfName = `${baseName} (${stamp}).pdf`;
  const pdf = await uploadPdfToFolder({ drive, pdfBuffer, pdfName, parentFolderId: pdfFolderId });

  return {
    doc_file_id: copied.id,
    doc_name: copied.name,
    pdf_file_id: pdf.id,
    pdf_name: pdf.name,
    doc_url: driveFileUrl(copied.id),
    pdf_url: driveFileUrl(pdf.id),
  };
}

module.exports = {
  ensurePatientFolderStructure,
  generateDocAndPdf,
  driveFolderUrl,
  driveFileUrl,
};
