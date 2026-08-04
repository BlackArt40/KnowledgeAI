// ---------------------------------------------------------------------------
// PPTX (OOXML) generator - zero dependencies.
//
// Criterion #1: 报告导出为 PPTX (大纲 -> 幻灯片).
// Builds a minimal but valid PresentationML package: [Content_Types].xml,
// presentation, slideMaster, slideLayout, theme, and one slide per outline
// heading. Each slide has a title placeholder + a body placeholder with
// bullet points. Packaged with the hand-rolled zip writer. Opens in
// PowerPoint / Keynote / Google Slides / LibreOffice.
// ---------------------------------------------------------------------------

import { zipFiles, type ZipEntry } from "./zip";
import type { AgentTask } from "../types";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface Slide {
  title: string;
  bullets: string[];
  cover?: boolean;
}

/** Extract slides from the report markdown: `#` = cover, `##` = content slide. */
function buildSlides(task: AgentTask): Slide[] {
  const md = task.report ?? "";
  const slides: Slide[] = [];
  let current: Slide | null = null;
  let hasCover = false;
  const topic = task.topic;

  for (const line of md.split("\n")) {
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      slides.push({ title: line.slice(2).trim() || topic, bullets: [], cover: true });
      hasCover = true;
      current = null;
      continue;
    }
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      current = { title: line.slice(3).trim(), bullets: [] };
      slides.push(current);
      continue;
    }
    if (line.startsWith("### ")) {
      const t = line.slice(4).trim();
      if (current) current.bullets.push(t);
      else { current = { title: t, bullets: [] }; slides.push(current); }
      continue;
    }
    const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (m) {
      const text = m[2].trim();
      if (current) current.bullets.push(text);
      else { current = { title: topic, bullets: [text] }; slides.push(current); }
      continue;
    }
    if (line.trim() && !line.startsWith(">") && line.trim() !== "---") {
      if (current) current.bullets.push(line.trim());
    }
  }
  if (slides.length === 0) slides.push({ title: topic, bullets: ["（无内容）"], cover: true });
  if (!hasCover) slides.unshift({ title: topic, bullets: [`数据来源：${task.kbName ?? "公开检索"}`], cover: true });
  return slides;
}

function bulletP(text: string): string {
  return `<a:p><a:pPr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="zh-CN" sz="1600"/><a:t>${esc(text)}</a:t></a:r></a:p>`;
}

function slideXml(slide: Slide): string {
  const titleP = `<a:p><a:r><a:rPr lang="zh-CN" sz="${slide.cover ? 4000 : 2800}" b="1"/><a:t>${esc(slide.title)}</a:t></a:r></a:p>`;
  const bodyPs = slide.bullets.length > 0 ? slide.bullets.map(bulletP).join("") : `<a:p><a:endParaRPr lang="zh-CN"/></a:p>`;
  return `${XML_HEAD}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/>${titleP}</p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/>${bodyPs}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

const THEME_XML = `${XML_HEAD}<a:theme xmlns:a="${A}" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const LAYOUT_XML = `${XML_HEAD}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="title" preserve="1">
  <p:cSld name="Title Slide">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`;

const MASTER_XML = `${XML_HEAD}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld>
    <p:bg><p:bgRef idx="1001"><a:schemeClr val="lt1"/></p:bgRef></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400" b="1"/></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></p:bodyStyle>
    <p:otherStyle/>
  </p:txStyles>
</p:sldMaster>`;

function contentTypesXml(n: number): string {
  const slideOverrides = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join("");
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`;
}

function presentationXml(n: number): string {
  const sldIds = Array.from({ length: n }, (_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`
  ).join("");
  return `${XML_HEAD}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${sldIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRelsXml(n: number): string {
  const slideRels = Array.from({ length: n }, (_, i) =>
    `<Relationship Id="rId${i + 2}" Type="${P}/slide" Target="slides/slide${i + 1}.xml"/>`
  ).join("");
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${P}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRels}
</Relationships>`;
}

const ROOT_RELS_XML = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

const MASTER_RELS_XML = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${P}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const LAYOUT_RELS_XML = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${P}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

function slideRelsXml(): string {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${P}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;
}

/** Generate a PPTX file (Uint8Array) from an agent task report. */
export function generatePptx(task: AgentTask): Uint8Array {
  const slides = buildSlides(task);
  const n = slides.length;
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: new TextEncoder().encode(contentTypesXml(n)) },
    { name: "_rels/.rels", data: new TextEncoder().encode(ROOT_RELS_XML) },
    { name: "ppt/presentation.xml", data: new TextEncoder().encode(presentationXml(n)) },
    { name: "ppt/_rels/presentation.xml.rels", data: new TextEncoder().encode(presentationRelsXml(n)) },
    { name: "ppt/theme/theme1.xml", data: new TextEncoder().encode(THEME_XML) },
    { name: "ppt/slideMasters/slideMaster1.xml", data: new TextEncoder().encode(MASTER_XML) },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: new TextEncoder().encode(MASTER_RELS_XML) },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: new TextEncoder().encode(LAYOUT_XML) },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: new TextEncoder().encode(LAYOUT_RELS_XML) },
  ];
  for (let i = 0; i < n; i++) {
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: new TextEncoder().encode(slideXml(slides[i])) });
    entries.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: new TextEncoder().encode(slideRelsXml()) });
  }
  return zipFiles(entries);
}
