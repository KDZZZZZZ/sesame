#ifndef PRODUCT_RESULTS_MQH
#define PRODUCT_RESULTS_MQH
#include <Product/Telemetry.mqh>

int ProductEquityHandle=INVALID_HANDLE;
datetime ProductEquityBar=0;
uint ProductEquityCount=0;
bool ProductEquityTruncated=false;
bool ProductTestCanceled()
  {
   if(MQLInfoInteger(MQL_TESTER) && FileIsExist(ProductOutputPath("cancel"),FILE_COMMON)) { TesterStop(); return true; }
   return false;
  }
string ProductNumber(double value) { return MathIsValidNumber(value) ? DoubleToString(value,8) : "null"; }
string ProductDecimal(double value) { return MathIsValidNumber(value) ? ProductQuote(DoubleToString(value,8)) : "null"; }
string ProductTime(datetime value)
  {
   string text=TimeToString(value,TIME_DATE|TIME_SECONDS);
   StringReplace(text,".","-"); StringReplace(text," ","T"); return ProductQuote(text);
  }
void ProductEquity(bool force=false)
  {
   if(!MQLInfoInteger(MQL_TESTER)) return;
   datetime bar=iTime(_Symbol,_Period,0);
   if(!force && bar==ProductEquityBar) return;
   ProductEquityBar=bar;
   if(ProductEquityCount>=50000) { ProductEquityTruncated=true; return; }
   if(ProductEquityHandle==INVALID_HANDLE)
      ProductEquityHandle=FileOpen(ProductOutputPath("equity.ndjson"),FILE_COMMON|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ,0,CP_UTF8);
   if(ProductEquityHandle==INVALID_HANDLE) return;
   FileWriteString(ProductEquityHandle,StringFormat("{\"time\":%s,\"balance\":%s,\"equity\":%s}\n",ProductTime(TimeCurrent()),ProductDecimal(AccountInfoDouble(ACCOUNT_BALANCE)),ProductDecimal(AccountInfoDouble(ACCOUNT_EQUITY))));
   FileFlush(ProductEquityHandle); ProductEquityCount++;
  }
double ProductTesterResult()
  {
   if(!MQLInfoInteger(MQL_TESTER) || !HistorySelect(0,TimeCurrent())) return 0;
   ProductEquity(true);
   if(ProductEquityHandle!=INVALID_HANDLE) { FileClose(ProductEquityHandle); ProductEquityHandle=INVALID_HANDLE; }
   int file=FileOpen(ProductOutputPath("result.json"),FILE_COMMON|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ,0,CP_UTF8);
   if(file==INVALID_HANDLE) { Print("Product results export failed: ",GetLastError()); return 0; }
   double initial=TesterStatistics(STAT_INITIAL_DEPOSIT), profit=TesterStatistics(STAT_PROFIT), trades=TesterStatistics(STAT_TRADES);
   FileWriteString(file,StringFormat("{\"schema_version\":1,\"run_id\":%s,\"build_id\":%s,\"sdk_version\":%s,\"symbol\":%s,\"period\":%s,\"time_basis\":\"broker_server_unspecified\",\"terminal_build\":%d,\"trace_truncated\":%s,\"equity_truncated\":%s,\"metrics\":{",
      ProductQuote(Product_RunId),ProductQuote(PRODUCT_BUILD_ID),ProductQuote(PRODUCT_SDK_VERSION),ProductQuote(_Symbol),ProductQuote(EnumToString(_Period)),(int)TerminalInfoInteger(TERMINAL_BUILD),ProductTraceTruncated ? "true" : "false",ProductEquityTruncated ? "true" : "false"));
   FileWriteString(file,StringFormat("\"currency\":%s,\"start_equity\":%s,\"end_equity\":%s,\"net_profit\":%s,\"return_pct\":%s,\"max_drawdown_pct\":%s,\"trade_count\":%d,\"win_rate_pct\":%s,\"equity_basis\":\"mark_to_market\",\"sample_kind\":\"in_sample\",\"profit_factor\":%s,\"sharpe_ratio\":%s},\"deals\":[",
      ProductQuote(AccountInfoString(ACCOUNT_CURRENCY)),ProductDecimal(initial),ProductDecimal(AccountInfoDouble(ACCOUNT_EQUITY)),ProductDecimal(profit),ProductNumber(initial>0 ? profit/initial*100 : 0),ProductNumber(TesterStatistics(STAT_EQUITY_DDREL_PERCENT)),(int)trades,trades>0 ? ProductNumber(TesterStatistics(STAT_PROFIT_TRADES)/trades*100) : "null",ProductNumber(TesterStatistics(STAT_PROFIT_FACTOR)),ProductNumber(TesterStatistics(STAT_SHARPE_RATIO))));
   int count=HistoryDealsTotal();
   for(int i=0;i<count;i++)
     {
      ulong ticket=HistoryDealGetTicket(i);
      if(i>0) FileWriteString(file,",");
      FileWriteString(file,StringFormat("{\"ticket\":\"%I64u\",\"order\":\"%I64u\",\"position_id\":\"%I64u\",\"time\":%s,\"time_msc\":\"%I64d\",\"symbol\":%s,\"type\":%s,\"entry\":%s,\"reason\":%s,\"volume\":%s,\"price\":%s,\"profit\":%s,\"commission\":%s,\"swap\":%s,\"fee\":%s}",
         ticket,(ulong)HistoryDealGetInteger(ticket,DEAL_ORDER),(ulong)HistoryDealGetInteger(ticket,DEAL_POSITION_ID),ProductTime((datetime)HistoryDealGetInteger(ticket,DEAL_TIME)),HistoryDealGetInteger(ticket,DEAL_TIME_MSC),ProductQuote(HistoryDealGetString(ticket,DEAL_SYMBOL)),ProductQuote(EnumToString((ENUM_DEAL_TYPE)HistoryDealGetInteger(ticket,DEAL_TYPE))),ProductQuote(EnumToString((ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket,DEAL_ENTRY))),ProductQuote(EnumToString((ENUM_DEAL_REASON)HistoryDealGetInteger(ticket,DEAL_REASON))),ProductDecimal(HistoryDealGetDouble(ticket,DEAL_VOLUME)),ProductDecimal(HistoryDealGetDouble(ticket,DEAL_PRICE)),ProductDecimal(HistoryDealGetDouble(ticket,DEAL_PROFIT)),ProductDecimal(HistoryDealGetDouble(ticket,DEAL_COMMISSION)),ProductDecimal(HistoryDealGetDouble(ticket,DEAL_SWAP)),ProductDecimal(HistoryDealGetDouble(ticket,DEAL_FEE))));
     }
   FileWriteString(file,"],\"completed\":true}"); FileClose(file);
   ProductEmit("tester_complete","platform.expert",ProductNumber(profit));
   return profit;
  }
#endif
