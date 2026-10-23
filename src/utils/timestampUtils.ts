/**
 * 时间戳格式化（纯函数，不依赖 VS Code API）。
 */

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 按指定占位符格式化时间戳。
 * 支持 YYYY、MM、DD、HH、mm、ss、WW（星期）；10 位时间戳按秒处理。
 */
export function formatTimestamp(
    timestamp: number | string,
    format: string = 'YYYY-MM-DD HH:mm:ss',
): string {
    const numTs = Number(timestamp);
    if (isNaN(numTs)) {
        console.warn('无效的时间戳:', timestamp);
        return '';
    }
    const ts = String(Math.trunc(numTs)).length === 10 ? numTs * 1000 : numTs;
    const date = new Date(ts);
    if (isNaN(date.getTime())) {
        console.warn('时间戳转换失败:', timestamp);
        return '';
    }
    const padZero = (num: number): string => num.toString().padStart(2, '0');

    return format
        .replace('YYYY', date.getFullYear().toString())
        .replace('MM', padZero(date.getMonth() + 1))
        .replace('DD', padZero(date.getDate()))
        .replace('HH', padZero(date.getHours()))
        .replace('mm', padZero(date.getMinutes()))
        .replace('ss', padZero(date.getSeconds()))
        .replace('WW', WEEKDAY_CN[date.getDay()]);
}
