const MONTHS_LONG=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"] as const;
const MONTHS_SHORT=["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"] as const;
const DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function parts(value:unknown,pattern:RegExp){if(typeof value!=="string")return null;const match=value.match(pattern);if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);if(month<1||month>12||day<1||day>31)return null;return{year,month,day,match}}
export function formatMonitoringTimestamp(value:unknown){const parsed=parts(value,TIMESTAMP);if(!parsed)return"Belum tersedia";return`${parsed.day} ${MONTHS_LONG[parsed.month-1]} ${parsed.year} · ${parsed.match[4]}.${parsed.match[5]} WIT`}
export function formatMonitoringDate(value:unknown,{short=false}:{short?:boolean}={}){const parsed=parts(value,DATE);if(!parsed)return"Belum tersedia";return`${parsed.day} ${(short?MONTHS_SHORT:MONTHS_LONG)[parsed.month-1]} ${parsed.year}`}
export function formatMonitoringDateRange(from:unknown,until:unknown){const start=parts(from,DATE),end=parts(until,DATE);if(!start||!end)return"Belum tersedia";if(start.year===end.year)return`${start.day} ${MONTHS_SHORT[start.month-1]}–${end.day} ${MONTHS_SHORT[end.month-1]} ${end.year}`;return`${start.day} ${MONTHS_SHORT[start.month-1]} ${start.year}–${end.day} ${MONTHS_SHORT[end.month-1]} ${end.year}`}
export function formatMonitoringSeason(value:unknown){return value==="MT1-2026"?"MT I 2026":value==="MT2-2026"?"MT II 2026":typeof value==="string"&&value.trim()?value:"Belum tersedia"}
const STATUS:Record<string,string>={approved:"Disetujui",pending:"Menunggu",monitored:"Terpantau",not_monitored:"Belum dipantau",prototype:"Prototipe",simulation:"Simulasi"};
export function formatMonitoringStatus(value:unknown){return typeof value==="string"&&value.trim()?(STATUS[value]??value):"Belum tersedia"}
export function formatMonitoringPercent(value:unknown){return typeof value==="number"&&Number.isFinite(value)?`${value.toLocaleString("id-ID",{maximumFractionDigits:1})}%`:"Belum tersedia"}
