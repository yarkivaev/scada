/** Fresh mixed-kind history for checking phase-only recovery boundaries. */
export default function checkpointRows(machine) {
    return [
        {machine,kind:'temperature',name:'273.419',start_time:new Date(3000),end_time:new Date(4000),duration:0,tags:null,options:null,properties:null},
        {machine,kind:'phase',name:'idle',start_time:new Date(1000),end_time:new Date(2000),duration:1,tags:'["reset"]',options:null,properties:null},
        {machine,kind:'phase',name:'running',start_time:new Date(3000),end_time:new Date(4000),duration:0,tags:null,options:null,properties:null},
        {machine,kind:'temperature',name:'291.357',start_time:new Date(5000),end_time:new Date(6000),duration:1,tags:'["reset"]',options:null,properties:null},
        {machine,kind:'temperature',name:'309.731',start_time:new Date(7000),end_time:new Date(8000),duration:0,tags:null,options:null,properties:null}
    ];
}
