import { capability, invokeValue } from '@sesame/plugin-sdk/capabilities';
export function createCapabilities(host) {return [
 capability('configuration_read',(input,signal)=>invokeValue(host,'host.configuration.read',input,{signal})),
 capability('configuration_update',(input,signal)=>invokeValue(host,'host.configuration.update',input,{signal})),
 capability('configuration_open',()=>host.views.open({surface:'settings'})),
 capability('configuration_integration_catalog',(input,signal)=>invokeValue(host,'host.configuration.catalog',input,{signal})),
 capability('configuration_integration_check',(input,signal)=>invokeValue(host,'host.configuration.check',input,{signal})),
 capability('configuration_integration_apply',(input,signal)=>invokeValue(host,'host.configuration.apply',input,{signal})),
 capability('configuration_integration_open',()=>host.views.open({surface:'integrations'}))
];}
