import { buildZip, type ZipEntry } from './zip';

/**
 * Minimal Word (.docx, Office Open XML) writer that runs on the device: paragraphs (title,
 * headings, normal and small text, bullets) and PNG / JPEG images scaled to the page width.
 * No library, no upload.
 */

export type DocxBlock =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; small?: boolean; muted?: boolean }
  | { kind: 'bullet'; text: string }
  | { kind: 'image'; data: Uint8Array; type: 'png' | 'jpeg'; width: number; height: number; alt?: string }
  | { kind: 'pageBreak' };

export interface DocxOptions {
  paper: 'a4' | 'letter' | 'legal';
  orientation: 'portrait' | 'landscape';
  /** Page margin in points. */
  margin: number;
  title?: string;
}

/** Paper sizes in twentieths of a point (twips). */
const PAPER_TWIPS: Record<DocxOptions['paper'], [number, number]> = { a4: [11906, 16838], letter: [12240, 15840], legal: [12240, 20160] };
const EMU_PER_TWIP = 635;
const EMU_PER_PX = 9525; // 96 dpi

export function xmlEscape(s: string): string {
  // Characters XML 1.0 does not allow are dropped.
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function run(text: string, props = ''): string {
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

/** Size an image to fit the text width (and a share of the page height), never enlarging it. */
export function fitImageEmu(width: number, height: number, maxW: number, maxH: number): { cx: number; cy: number } {
  const w = width * EMU_PER_PX;
  const h = height * EMU_PER_PX;
  const s = Math.min(1, maxW / w, maxH / h);
  return { cx: Math.max(1, Math.round(w * s)), cy: Math.max(1, Math.round(h * s)) };
}

export function buildDocx(blocks: DocxBlock[], opts: DocxOptions): Uint8Array {
  let [pw, ph] = PAPER_TWIPS[opts.paper];
  if (opts.orientation === 'landscape') [pw, ph] = [ph, pw];
  const margin = Math.round(opts.margin * 20);
  const maxW = (pw - margin * 2) * EMU_PER_TWIP;
  const maxH = (ph - margin * 2) * EMU_PER_TWIP * 0.82;

  const media: Array<{ name: string; data: Uint8Array; rid: string }> = [];
  const body: string[] = [];
  let imageNo = 0;
  for (const b of blocks) {
    switch (b.kind) {
      case 'title':
        body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(b.text)}</w:p>`);
        break;
      case 'heading':
        body.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/></w:pPr>${run(b.text)}</w:p>`);
        break;
      case 'text':
        body.push(`<w:p>${run(b.text, `${b.small ? '<w:sz w:val="18"/>' : ''}${b.muted ? '<w:color w:val="667085"/>' : ''}`)}</w:p>`);
        break;
      case 'bullet':
        body.push(`<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(b.text)}</w:p>`);
        break;
      case 'pageBreak':
        body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        break;
      case 'image': {
        imageNo++;
        const rid = `rIdImg${imageNo}`;
        const name = `image${imageNo}.${b.type === 'jpeg' ? 'jpg' : 'png'}`;
        media.push({ name, data: b.data, rid });
        const { cx, cy } = fitImageEmu(b.width, b.height, maxW, maxH);
        const alt = xmlEscape(b.alt ?? `Image ${imageNo}`);
        body.push(
          `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
            `<wp:docPr id="${imageNo}" name="Picture ${imageNo}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
            `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imageNo}" name="${name}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
            `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
            `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="6350"><a:solidFill><a:srgbClr val="D0D5DD"/></a:solidFill></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
        );
        break;
      }
    }
  }

  const sect = `<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"${opts.orientation === 'landscape' ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="420" w:footer="420" w:gutter="0"/></w:sectPr>`;
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:body>${body.join('')}${sect}</w:body></w:document>`;

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:color w:val="1D2433"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="101828"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="101828"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>' +
    '</w:styles>';

  const numbering =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    media.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('') +
    '</Relationships>';

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlEscape(opts.title ?? '')}</dc:title><dc:creator>Pixora</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ];
  return buildZip(entries);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
