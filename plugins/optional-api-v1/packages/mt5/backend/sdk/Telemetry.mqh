#ifndef PRODUCT_TELEMETRY_MQH
#define PRODUCT_TELEMETRY_MQH
#include <Product/Build.mqh>

int ProductTraceHandle=INVALID_HANDLE;
ulong ProductTraceSequence=0;
string ProductDecisionId="";
input string Product_RunId="manual";
input bool Product_EnableLive=false;
input string Product_AccountLogin="";
input string Product_AccountServer="";
bool ProductTraceTruncated=false;
string ProductOutputPath(string name) { return "MT5Agent\\"+Product_RunId+"\\"+name; }
bool ProductExecutionAllowed()
  {
   if(MQLInfoInteger(MQL_TESTER)) return true;
   return Product_EnableLive && StringFind(Product_RunId,"deploy_")==0 &&
          Product_AccountLogin==IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) &&
          Product_AccountServer==AccountInfoString(ACCOUNT_SERVER) &&
          !FileIsExist(ProductOutputPath("stop"),FILE_COMMON);
  }
string ProductQuote(string value)
  {
   StringReplace(value,"\\","\\\\"); StringReplace(value,"\"","\\\"");
   StringReplace(value,"\r","\\r"); StringReplace(value,"\n","\\n"); StringReplace(value,"\t","\\t");
   return "\""+value+"\"";
  }
// The backend accepts at most 200000 rows and 32 MiB with contiguous seq numbers.
// Routine rows stop at the soft limit; the reserve above it keeps every decision that
// reaches the broker explainable for the whole run (its buffered path, risk check,
// request result with order/deal tickets, and transactions), so trades stay linkable.
#define PRODUCT_TRACE_MAX_ROWS 200000
#define PRODUCT_TRACE_MAX_BYTES 33554432
#define PRODUCT_TRACE_SOFT_ROWS 180000
#define PRODUCT_TRACE_SOFT_BYTES 29360128
#define PRODUCT_TRACE_PENDING_MAX 4096
string ProductPending[];
int ProductPendingCount=0;
string ProductPendingDecision="";
bool ProductTraceWrite(string body,bool soft)
  {
   ulong rows=soft ? PRODUCT_TRACE_SOFT_ROWS : PRODUCT_TRACE_MAX_ROWS;
   ulong limit=soft ? PRODUCT_TRACE_SOFT_BYTES : PRODUCT_TRACE_MAX_BYTES;
   if(ProductTraceSequence>=rows) return false;
   string row=StringFormat("{\"seq\":%I64u,",ProductTraceSequence+1)+body+"\r\n";
   // Count UTF-8 bytes and native CRLF exactly as the backend bound does.
   uchar encoded[];
   int bytes=StringToCharArray(row,encoded,0,WHOLE_ARRAY,CP_UTF8)-1;
   if(bytes<0 || FileTell(ProductTraceHandle)+(ulong)bytes>limit) return false;
   FileWriteString(ProductTraceHandle,row); ProductTraceSequence++; FileFlush(ProductTraceHandle);
   return true;
  }
void ProductEmit(string kind,string node,string value_json)
  {
   if(ProductTraceHandle==INVALID_HANDLE) return;
   // seq is assigned when a row is written, so rows kept back still number contiguously.
   string body=StringFormat("\"time\":%I64d,\"build_id\":%s,\"decision_id\":%s,\"kind\":%s,\"node_id\":%s,\"value\":%s}",
      (long)TimeCurrent(),ProductQuote(PRODUCT_BUILD_ID),ProductQuote(ProductDecisionId),ProductQuote(kind),ProductQuote(node),value_json);
   if(!ProductTraceTruncated && ProductTraceWrite(body,true)) return;
   // Past the soft limit: report truncation, keep only the current decision in memory.
   // Telemetry never stops the Tester; statistics and the ledger still complete.
   ProductTraceTruncated=true;
   if(ProductPendingDecision!=ProductDecisionId) { ProductPendingCount=0; ProductPendingDecision=ProductDecisionId; }
   bool order=kind=="risk" || kind=="request_result";
   bool essential=order || kind=="transaction" || kind=="state_transition" || kind=="runtime_error";
   if(!essential)
     {
      if(ProductPendingCount<PRODUCT_TRACE_PENDING_MAX)
        { if(ProductPendingCount>=ArraySize(ProductPending)) ArrayResize(ProductPending,ProductPendingCount+256); ProductPending[ProductPendingCount++]=body; }
      return;
     }
   if(order)
     {
      for(int i=0;i<ProductPendingCount;i++) if(!ProductTraceWrite(ProductPending[i],false)) break;
      ProductPendingCount=0;
     }
   ProductTraceWrite(body,false);
  }
bool ProductTraceOpen()
  {
   if(StringFind(Product_RunId,"..")>=0 || StringFind(Product_RunId,"\\")>=0 || StringFind(Product_RunId,"/")>=0) return false;
   FolderCreate("MT5Agent",FILE_COMMON); FolderCreate("MT5Agent\\"+Product_RunId,FILE_COMMON);
   bool live=!MQLInfoInteger(MQL_TESTER);
   ProductTraceHandle=FileOpen(ProductOutputPath("trace.ndjson"),FILE_COMMON|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|(live ? FILE_READ : 0),0,CP_UTF8);
   if(ProductTraceHandle==INVALID_HANDLE) return false;
   // Native chart/terminal reinitialization must preserve earlier live decisions.
   ProductTraceSequence=0;
   if(live)
     {
      if(FileSize(ProductTraceHandle)>PRODUCT_TRACE_MAX_BYTES) { FileClose(ProductTraceHandle); ProductTraceHandle=INVALID_HANDLE; return false; }
      while(!FileIsEnding(ProductTraceHandle))
        {
         string row=FileReadString(ProductTraceHandle);
         if(row=="") continue;
         string prefix=StringFormat("{\"seq\":%I64u,",ProductTraceSequence+1);
         if(StringFind(row,prefix)!=0 || StringFind(row,"\"build_id\":"+ProductQuote(PRODUCT_BUILD_ID)+",")<0 || StringSubstr(row,StringLen(row)-1)!="}" || ProductTraceSequence>=PRODUCT_TRACE_MAX_ROWS)
           { FileClose(ProductTraceHandle); ProductTraceHandle=INVALID_HANDLE; return false; }
         ProductTraceSequence++;
        }
      FileSeek(ProductTraceHandle,0,SEEK_END);
     }
   ProductTraceTruncated=ProductTraceSequence>=PRODUCT_TRACE_SOFT_ROWS || FileTell(ProductTraceHandle)>=PRODUCT_TRACE_SOFT_BYTES;
   if(live) ProductEmit("lifecycle","platform.permissions",StringFormat("{\"trade_allowed\":%s,\"dll_allowed\":%s,\"chart_id\":\"%I64d\"}",
      MQLInfoInteger(MQL_TRADE_ALLOWED) ? "true" : "false", MQLInfoInteger(MQL_DLLS_ALLOWED) ? "true" : "false", ChartID()));
   return true;
  }
void ProductTraceClose() { if(ProductTraceHandle!=INVALID_HANDLE) FileClose(ProductTraceHandle); ProductTraceHandle=INVALID_HANDLE; }
void ProductTransaction(const MqlTradeTransaction &tx,const MqlTradeRequest &request,const MqlTradeResult &result)
  {
   ProductEmit("transaction","platform.trade",StringFormat("{\"type\":%s,\"request_id\":%u,\"order\":\"%I64u\",\"deal\":\"%I64u\",\"position\":\"%I64u\",\"volume\":%.8f,\"price\":%.8f,\"retcode\":%u}",
      ProductQuote(EnumToString(tx.type)),result.request_id,tx.order,tx.deal,tx.position,tx.volume,tx.price,result.retcode));
  }
#endif
