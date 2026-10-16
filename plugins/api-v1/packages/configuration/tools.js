import { capability, invokeValue } from '@sesame/plugin-sdk/capabilities';
export function createCapabilities(host) {return [
 capability('configuration_read',(input,signal)=>invokeValue(host,'host.configuration.read',input,{signal})),
 capability('configuration_update',(input,signal)=>invokeValue(host,'host.configuration.update',input,{signal})),
 capability('configuration_open',()=>host.views.open({surface:'settings'}))
];}
