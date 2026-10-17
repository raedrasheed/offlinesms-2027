export function filePresentation(name?: string|null, mime?: string|null, bytes=0) {
  const ext=(name?.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? '').toUpperCase();
  const type=ext || (mime==='application/pdf'?'PDF':mime?.includes('word')?'DOC':mime?.includes('sheet')?'XLS':'FILE');
  const kind=/^(DOCX?|ODT)$/.test(type)?'word':/^(XLSX?|CSV|ODS)$/.test(type)?'sheet':/^(PPTX?|ODP)$/.test(type)?'slides':type==='PDF'?'pdf':/^(ZIP|RAR|7Z)$/.test(type)?'archive':'file';
  const icon={word:['W','#2B6CD4'],sheet:['X','#23844A'],slides:['P','#D46635'],pdf:['PDF','#E34848'],archive:['ZIP','#8960A9'],file:[type.slice(0,4),'#71838E']}[kind];
  const size=Math.max(0,Number.isFinite(bytes)?bytes:0);
  const amount=size<1024?`${Math.round(size)} B`:size<1024*1024?`${Math.round(size/1024)} kB`:`${(size/1024/1024).toFixed(1).replace(/\.0$/,'')} MB`;
  return {type,badge:icon[0],color:icon[1],size:amount};
}
