const MONTHS_LONG=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"] as const;
const MONTHS_SHORT=["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"] as const;
const DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))$/;

function parts(value:unknown,pattern:RegExp){if(typeof value!=="string")return null;const match=value.match(pattern);if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];if(month<1||month>12||day<1||day>days[month-1])return null;return{year,month,day,match}}
function timestampInstant(value:unknown){const parsed=parts(value,TIMESTAMP);if(!parsed)return null;const hour=Number(parsed.match[4]),minute=Number(parsed.match[5]),second=Number(parsed.match[6]??0),offsetHour=Number(parsed.match[10]??0),offsetMinute=Number(parsed.match[11]??0);if(hour>23||minute>59||second>59||offsetHour>23||offsetMinute>59)return null;const instant=Date.parse(value as string);return Number.isFinite(instant)?instant:null}
const WIT_FORMATTER=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jayapura",year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
export function formatMonitoringTimestamp(value:unknown){const instant=timestampInstant(value);if(instant===null)return"Belum tersedia";const formatted=Object.fromEntries(WIT_FORMATTER.formatToParts(instant).map(part=>[part.type,part.value]));return`${Number(formatted.day)} ${MONTHS_LONG[Number(formatted.month)-1]} ${formatted.year} · ${formatted.hour}.${formatted.minute} WIT`}
export function latestMonitoringTimestamp(values:readonly unknown[]){let latest:string|null=null,latestInstant=-Infinity;for(const value of values){const instant=timestampInstant(value);if(instant!==null&&instant>latestInstant){latestInstant=instant;latest=value as string}}return latest}
export function formatMonitoringDate(value:unknown,{short=false}:{short?:boolean}={}){const parsed=parts(value,DATE);if(!parsed)return"Belum tersedia";return`${parsed.day} ${(short?MONTHS_SHORT:MONTHS_LONG)[parsed.month-1]} ${parsed.year}`}
export function formatMonitoringDateRange(from:unknown,until:unknown){const start=parts(from,DATE),end=parts(until,DATE);if(!start||!end)return"Belum tersedia";if(start.year===end.year)return`${start.day} ${MONTHS_SHORT[start.month-1]}–${end.day} ${MONTHS_SHORT[end.month-1]} ${end.year}`;return`${start.day} ${MONTHS_SHORT[start.month-1]} ${start.year}–${end.day} ${MONTHS_SHORT[end.month-1]} ${end.year}`}
export function formatMonitoringSeason(value:unknown){return value==="MT1-2026"?"MT I 2026":value==="MT2-2026"?"MT II 2026":typeof value==="string"&&value.trim()?value:"Belum tersedia"}
const STATUS:Record<string,string>={
 approved:"Disetujui",pending:"Menunggu validasi",rejected:"Ditolak",draft:"Draf",
 monitored:"Terpantau",not_monitored:"Belum dipantau",not_available:"Belum tersedia",
 completed:"Selesai",in_progress:"Berjalan",running:"Berjalan",delayed:"Tertunda",planned:"Direncanakan",expired:"Selesai/Kedaluwarsa",
 low:"Rendah",medium:"Sedang",high:"Tinggi",critical:"Kritis",prototype:"Prototipe",simulation:"Simulasi",
 Disetujui:"Disetujui","Menunggu validasi":"Menunggu validasi",Ditolak:"Ditolak",Draf:"Draf",Terpantau:"Terpantau","Belum dipantau":"Belum dipantau","Belum tersedia":"Belum tersedia",
 Selesai:"Selesai",Berjalan:"Berjalan",Tertunda:"Tertunda",Direncanakan:"Direncanakan",Rendah:"Rendah",Sedang:"Sedang",Tinggi:"Tinggi",Kritis:"Kritis",Normal:"Normal",Waspada:"Waspada",Siaga:"Siaga","Selesai/Kedaluwarsa":"Selesai/Kedaluwarsa",Prototipe:"Prototipe",Simulasi:"Simulasi",
 "Banjir/genangan":"Banjir/genangan","Ketersediaan air":"Ketersediaan air","Hama dan penyakit":"Hama dan penyakit",Kekeringan:"Kekeringan","Gangguan produksi":"Gangguan produksi",
};
export function formatMonitoringStatus(value:unknown){return typeof value==="string"&&value.trim()?(STATUS[value.trim()]??"Belum tersedia"):"Belum tersedia"}
export function formatMonitoringSources(values:readonly unknown[]){const seen=new Set<string>(),sources:string[]=[];for(const value of values)if(typeof value==="string")for(const part of value.split(";")){const source=part.trim();if(source&&!seen.has(source)){seen.add(source);sources.push(source)}}return sources.length?sources.join("; "):"Belum tersedia"}
export function formatMonitoringPercent(value:unknown){return typeof value==="number"&&Number.isFinite(value)?`${value.toLocaleString("id-ID",{maximumFractionDigits:1})}%`:"Belum tersedia"}
