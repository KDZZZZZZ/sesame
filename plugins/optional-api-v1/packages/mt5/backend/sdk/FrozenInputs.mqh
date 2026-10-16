#ifndef PRODUCT_FROZEN_INPUTS_MQH
#define PRODUCT_FROZEN_INPUTS_MQH
#include <Product/Telemetry.mqh>
// Reads only a pass-owned frozen Tester file, never a live signal or model API.
// Caller supplies UTC replay time; TimeCurrent() is broker wall time, not UTC.
string ProductFrozenRows[];
int ProductFrozenPosition=0;
long ProductFrozenClock=-1;
bool ProductFrozenOpened=false;
string ProductFrozenEventDigest(string event_json)
  {
   uchar bytes[],key[],hashed[];
   int count=StringToCharArray(event_json,bytes,0,WHOLE_ARRAY,CP_UTF8)-1;
   if(count<0) return "";
   ArrayResize(bytes,count);
   if(CryptEncode(CRYPT_HASH_SHA256,bytes,key,hashed)!=32) return "";
   string result="sha256:";
   for(int i=0;i<ArraySize(hashed);i++) result+=StringFormat("%02x",(int)hashed[i]);
   return result;
  }
bool ProductFrozenOpen(string expected_digest)
  {
   if(!MQLInfoInteger(MQL_TESTER) || ProductFrozenOpened) return false;
   int handle=FileOpen(ProductOutputPath("svl-timeline.ndjson"),FILE_COMMON|FILE_READ|FILE_BIN);
   if(handle==INVALID_HANDLE) return false;
   long size=(long)FileSize(handle);
   if(size<=0 || size>1048576) { FileClose(handle); return false; }
   uchar bytes[],key[],hashed[];
   ArrayResize(bytes,(int)size);
   uint count=FileReadArray(handle,bytes,0,(int)size); FileClose(handle);
   if(count!=(uint)size || CryptEncode(CRYPT_HASH_SHA256,bytes,key,hashed)!=32) return false;
   string actual="sha256:";
   for(int i=0;i<ArraySize(hashed);i++) actual+=StringFormat("%02x",(int)hashed[i]);
   if(actual!=expected_digest) return false;
   string data=CharArrayToString(bytes,0,(int)size,CP_UTF8);
   if(StringLen(data)<2 || StringSubstr(data,StringLen(data)-1)!="\n") return false;
   int rows=StringSplit(StringSubstr(data,0,StringLen(data)-1),'\n',ProductFrozenRows);
   if(rows<1 || rows>10000) return false;
   long previous=-1;
   for(int i=0;i<rows;i++)
     {
      string row=ProductFrozenRows[i]; int comma=StringFind(row,",");
      if(StringFind(row,"{\"availableAtMs\":")!=0 || comma<=17 || StringFind(row,",\"event\":")<0) return false;
      string digits=StringSubstr(row,17,comma-17);
      for(int j=0;j<StringLen(digits);j++) if(StringGetCharacter(digits,j)<'0' || StringGetCharacter(digits,j)>'9') return false;
      long available=(long)StringToInteger(digits);
      if(available<previous || available<0 || available>9007199254740991) return false;
      previous=available;
     }
   ProductFrozenPosition=0; ProductFrozenClock=-1; ProductFrozenOpened=true;
   ProductEmit("external_input_file","svl.fixture",StringFormat("{\"digest\":%s,\"rows\":%d}",ProductQuote(actual),rows));
   return true;
  }
// 1 = available payload; 0 = not available/end; -1 = invalid/nonmonotone clock.
// Payload is the exact frozen event JSON. Translation must type-check its fields,
// sequence, scope, dataCutoffAt/availableAt/expiry and guard state before new risk.
int ProductFrozenNext(long as_of_utc_ms,string &event_json)
  {
   event_json="";
   if(!ProductFrozenOpened || as_of_utc_ms<ProductFrozenClock || as_of_utc_ms<0) return -1;
   ProductFrozenClock=as_of_utc_ms;
   if(ProductFrozenPosition>=ArraySize(ProductFrozenRows)) return 0;
   string row=ProductFrozenRows[ProductFrozenPosition]; int comma=StringFind(row,",");
   long available=(long)StringToInteger(StringSubstr(row,17,comma-17));
   if(available>as_of_utc_ms) return 0;
   int start=StringFind(row,",\"event\":")+9;
   event_json=StringSubstr(row,start,StringLen(row)-start-1);
   ProductFrozenPosition++; return 1;
  }
#endif
