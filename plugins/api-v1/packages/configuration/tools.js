import { capability, invokeValue } from '@sesame/plugin-sdk/capabilities';
function originalValues(input, values) {
 if (Object.values(values ?? {}).some(value => value === '[redacted]')) throw Object.assign(new Error('不能把隐藏密钥后的占位文字保存为配置。请使用用户提供的原始值；保留已有配置时省略该项。'), {code:'INVALID_ARGUMENT'});
 return input;
}
export function createCapabilities(host) {return [
 capability('configuration_read',(input,signal)=>invokeValue(host,'host.configuration.read',input,{signal})),
 capability('configuration_update',(input,signal)=>invokeValue(host,'host.configuration.update',originalValues(input,input.changes),{signal})),
 capability('configuration_open',()=>host.views.open({surface:'settings'})),
 capability('configuration_integration_catalog',(input,signal)=>invokeValue(host,'host.configuration.catalog',input,{signal})),
 capability('configuration_integration_check',(input,signal)=>invokeValue(host,'host.configuration.check',input,{signal})),
 capability('configuration_integration_apply',(input,signal)=>invokeValue(host,'host.configuration.apply',originalValues(input,input.values),{signal})),
 capability('configuration_integration_open',()=>host.views.open({surface:'integrations'}))
];}
