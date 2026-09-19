const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require("docx");

function textParagraph(text, options = {}) {
  return new Paragraph({
    children: [new TextRun({ text: String(text || ""), bold: !!options.bold, size: options.size || 21 })],
    spacing: { after: 80 },
    ...options.paragraph
  });
}

function heading(text, level = HeadingLevel.HEADING_2) {
  return new Paragraph({
    text: String(text),
    heading: level,
    spacing: { before: 180, after: 90 }
  });
}

function bullet(text) {
  return new Paragraph({ text: String(text), bullet: { level: 0 }, spacing: { after: 60 } });
}

function renderCVDocx(candidate, cv) {
  const children = [];
  children.push(new Paragraph({
    children: [new TextRun({ text: candidate.candidateName || "Candidate", bold: true, size: 34 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 70 }
  }));
  children.push(new Paragraph({ text: candidate.candidateEmail || "", alignment: AlignmentType.CENTER, spacing: { after: 160 } }));

  if (cv.professionalSummary) {
    children.push(heading("Professional Summary"));
    children.push(textParagraph(cv.professionalSummary));
  }

  if (cv.skills?.length) {
    children.push(heading("Skills"));
    children.push(textParagraph(cv.skills.map((s) => s.name).filter(Boolean).join(" • ")));
  }

  if (cv.experience?.length) {
    children.push(heading("Experience"));
    for (const item of cv.experience) {
      children.push(textParagraph(`${item.jobTitle || "Role"} — ${item.company || ""}`, { bold: true }));
      if (item.dates || item.location) children.push(textParagraph([item.dates, item.location].filter(Boolean).join(" | ")));
      for (const b of item.bullets || []) children.push(bullet(b));
    }
  }

  if (cv.projects?.length) {
    children.push(heading("Projects"));
    for (const item of cv.projects) {
      children.push(textParagraph(item.name || "Project", { bold: true }));
      if (item.dates) children.push(textParagraph(item.dates));
      for (const b of item.bullets || []) children.push(bullet(b));
    }
  }

  if (cv.education?.length) {
    children.push(heading("Education"));
    for (const item of cv.education) {
      children.push(textParagraph(`${item.qualification || ""} — ${item.institution || ""}`, { bold: true }));
      if (item.dates) children.push(textParagraph(item.dates));
      for (const d of item.details || []) children.push(bullet(d));
    }
  }

  if (cv.certifications?.length) {
    children.push(heading("Certifications"));
    for (const item of cv.certifications) {
      children.push(bullet([item.name, item.issuer, item.date].filter(Boolean).join(" — ")));
    }
  }

  if (cv.achievements?.length) {
    children.push(heading("Achievements"));
    for (const item of cv.achievements) children.push(bullet(item));
  }

  return Packer.toBuffer(new Document({
    sections: [{
      properties: {},
      children,
      headers: {},
      footers: {}
    }]
  }));
}

function renderCoverLetterDocx(candidate, job, cover) {
  const paragraphs = String(cover.coverLetter || "").split(/\n\s*\n/).filter(Boolean);
  const children = [
    textParagraph(candidate.candidateName || "Candidate", { bold: true, size: 28 }),
    textParagraph(candidate.candidateEmail || ""),
    textParagraph(new Date().toLocaleDateString("en-GB")),
    textParagraph(""),
    textParagraph(`Application for ${job.title || "the role"}`, { bold: true, size: 24 })
  ];
  for (const p of paragraphs) children.push(textParagraph(p));

  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

module.exports = { renderCVDocx, renderCoverLetterDocx };
