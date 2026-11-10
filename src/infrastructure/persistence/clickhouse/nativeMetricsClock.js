/** Publication and standby cleanup share the authoritative target's clock. */
export default async function nativeMetricsClock(client,options={}) {
    if(options.now){return options.now();}
    const response=await client.query({query:'SELECT toUnixTimestamp64Milli(now64(3)) AS current_ms',format:'JSONEachRow'});
    const [row]=await response.json();
    const value=Number(row?.current_ms);
    if(!Number.isSafeInteger(value)){throw new Error('Invalid authoritative history publication clock');}
    return value;
}
