/** Canonical nonnegative decimals: 30 integral digits and 18 fractional digits. */
export const DECIMAL_SCALE=10n**18n;
export function decimalAmount(value:string):bigint {
 if(!/^\d{1,30}(?:\.\d{1,18})?$/u.test(value))throw Error("DECIMAL_INVALID");
 const [whole,fraction=""]=value.split(".");return BigInt(whole!)*DECIMAL_SCALE+BigInt(fraction.padEnd(18,"0"));
}
export function decimalString(value:bigint):string {
 if(value<0n)throw Error("DECIMAL_NEGATIVE");
 const whole=value/DECIMAL_SCALE,fraction=(value%DECIMAL_SCALE).toString().padStart(18,"0").replace(/0+$/u,"");return `${whole}${fraction?`.${fraction}`:""}`;
}
