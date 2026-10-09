#ifndef PRODUCT_VISUAL_MQH
#define PRODUCT_VISUAL_MQH
#include <Product/Telemetry.mqh>

// Versioned, platform-owned observation and effect boundary. Source modules can
// call only the signatures in visual/catalog.js, never these globals directly.
long V_Event=0;
int V_Steps=0;
bool V_Fault=false;
string V_EventKind="init";
MqlRates V_Rates[];
int V_RateCount=0;
MqlTick V_Quote;
double V_EquityValue=0,V_BalanceValue=0,V_FreeMarginValue=0,V_PointValue=0;
double V_MinLot=0,V_MaxLot=0,V_StepLot=0,V_TickSizeValue=0,V_TickLoss=0,V_TickProfit=0;
long V_TimeValue=0;
struct V_PositionFact { ulong ticket; bool buy; double volume; double price; double sl; double tp; };
V_PositionFact V_Positions[64];
int V_PositionSize=0;
MqlTradeTransaction V_Transaction;

void V_Fail(string node,string reason) {
 if(!V_Fault) ProductEmit("runtime_error",node,"{\"event\":"+IntegerToString(V_Event)+",\"reason\":"+ProductQuote(reason)+"}");
 V_Fault=true;
}
bool V_Step(string node) {
 if(V_Fault) return false;
 if(++V_Steps>200000) { V_Fail(node,"event_budget_exceeded"); return false; }
 ProductEmit("control",node,"{\"event\":"+IntegerToString(V_Event)+"}"); return true;
}
void V_Observe(string node) { if(!V_Fault) ProductEmit("action",node,"{\"event\":"+IntegerToString(V_Event)+"}"); }
bool V_Bool(string node,bool value) {
 if(V_Fault) return false;
 ProductEmit("condition",node,"{\"event\":"+IntegerToString(V_Event)+",\"result\":"+(value ? "true" : "false")+"}"); return value;
}
double V_Number(double value,string node) {
 if(!MathIsValidNumber(value)) { V_Fail(node,"non_finite_number"); return 0; }
 if(!V_Fault) ProductEmit("value",node,"{\"event\":"+IntegerToString(V_Event)+",\"value\":"+DoubleToString(value,16)+"}"); return value;
}
int V_Index(long value,int capacity,string node) { if(value<0 || value>=capacity) { V_Fail(node,"index_out_of_bounds"); return 0; } return (int)value; }
double V_Missing(string node) { V_Fail(node,"input_unavailable"); return 0; }
double V_Div(double a,double b,string node) { if(b==0) return V_Missing(node); return a/b; }
long V_DivInt(long a,long b,string node) { if(b==0 || (a==LONG_MIN && b==-1)) { V_Fail(node,"invalid_integer_division"); return 0; } return a/b; }
long V_Mod(long a,long b,string node) { if(b==0 || (a==LONG_MIN && b==-1)) { V_Fail(node,"invalid_integer_remainder"); return 0; } return a%b; }
void V_Assign_double(double &target,double value,int op,string node) {
 if(V_Fault) return;
 double next=op==0 ? value : op==1 ? target+value : op==2 ? target-value : op==3 ? target*value : V_Div(target,value,node);
 next=V_Number(next,node); if(!V_Fault) target=next;
}
void V_Assign_long(long &target,long value,int op,string node) {
 if(V_Fault) return;
 long next=op==0 ? value : op==1 ? target+value : op==2 ? target-value : op==3 ? target*value : V_DivInt(target,value,node);
 if(!V_Fault) target=next;
}
void V_Assign_int(int &target,int value,int op,string node) {
 if(V_Fault) return;
 int next=op==0 ? value : op==1 ? target+value : op==2 ? target-value : op==3 ? target*value : (int)V_DivInt(target,value,node);
 if(!V_Fault) target=next;
}
int V_ToInt(double value) { if(!MathIsValidNumber(value) || value<INT_MIN || value>INT_MAX) { V_Fail("platform.visual","integer_range"); return 0; } return (int)value; }
void V_Transition(string machine,string transition,string from_state,string to_state,int slot) {
 if(V_Fault) return;
 ProductEmit("state_transition",machine,"{\"event\":"+IntegerToString(V_Event)+",\"transition_id\":"+ProductQuote(transition)+",\"from_state\":"+ProductQuote(from_state)+",\"to_state\":"+ProductQuote(to_state)+",\"instance\":"+IntegerToString(slot)+"}");
}

void V_Begin(string kind,ulong magic) {
 // Faults remain latched for the run; a later tick cannot silently clear a
 // violated assumption and start submitting new risk again.
 V_Event++; V_Steps=0; V_EventKind=kind;
 ProductDecisionId=PRODUCT_BUILD_ID+":"+IntegerToString(V_Event);
 ArraySetAsSeries(V_Rates,true);
 V_RateCount=CopyRates(_Symbol,_Period,0,512,V_Rates); if(V_RateCount<0) V_RateCount=0;
 if(!SymbolInfoTick(_Symbol,V_Quote)) ZeroMemory(V_Quote);
 V_PointValue=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
 V_TickSizeValue=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE); V_TickLoss=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE_LOSS); V_TickProfit=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE_PROFIT);
 V_MinLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN); V_MaxLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX); V_StepLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
 V_EquityValue=AccountInfoDouble(ACCOUNT_EQUITY); V_BalanceValue=AccountInfoDouble(ACCOUNT_BALANCE); V_FreeMarginValue=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
 V_TimeValue=(long)TimeCurrent(); V_PositionSize=0;
 for(int i=0;i<PositionsTotal();i++) {
   ulong ticket=PositionGetTicket(i); if(ticket==0 || PositionGetString(POSITION_SYMBOL)!=_Symbol || (ulong)PositionGetInteger(POSITION_MAGIC)!=magic) continue;
   if(V_PositionSize>=64) { V_Fail("platform.visual","position_capacity_exceeded"); break; }
   int n=V_PositionSize++; V_Positions[n].ticket=ticket; V_Positions[n].buy=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
   V_Positions[n].volume=PositionGetDouble(POSITION_VOLUME); V_Positions[n].price=PositionGetDouble(POSITION_PRICE_OPEN);
   V_Positions[n].sl=PositionGetDouble(POSITION_SL); V_Positions[n].tp=PositionGetDouble(POSITION_TP);
 }
 if(kind!="transaction") ZeroMemory(V_Transaction);
 ProductEmit("event","platform.visual","{\"event\":"+IntegerToString(V_Event)+",\"kind\":"+ProductQuote(kind)+",\"bars\":"+IntegerToString(V_RateCount)+",\"positions\":"+IntegerToString(V_PositionSize)+"}");
}
int V_Bars() { return V_RateCount; }
double V_Open(int i) { if(i<0 || i>=V_RateCount) return V_Missing("platform.bars"); return V_Rates[i].open; }
double V_High(int i) { if(i<0 || i>=V_RateCount) return V_Missing("platform.bars"); return V_Rates[i].high; }
double V_Low(int i) { if(i<0 || i>=V_RateCount) return V_Missing("platform.bars"); return V_Rates[i].low; }
double V_Close(int i) { if(i<0 || i>=V_RateCount) return V_Missing("platform.bars"); return V_Rates[i].close; }
double V_Volume(int i) { if(i<0 || i>=V_RateCount) return V_Missing("platform.bars"); return (double)V_Rates[i].tick_volume; }
long V_BarTime(int i) { if(i<0 || i>=V_RateCount) return (long)V_Missing("platform.bars"); return (long)V_Rates[i].time; }
double V_Bid() { if(V_Quote.bid<=0) return V_Missing("platform.quote"); return V_Quote.bid; }
double V_Ask() { if(V_Quote.ask<=0) return V_Missing("platform.quote"); return V_Quote.ask; }
double V_Point() { return V_PointValue; }
double V_TickSize() { return V_TickSizeValue; }
double V_TickValueLoss() { return V_TickLoss; }
double V_TickValueProfit() { return V_TickProfit; }
double V_Equity() { return V_EquityValue; }
double V_Balance() { return V_BalanceValue; }
double V_FreeMargin() { return V_FreeMarginValue; }
double V_LotMin() { return V_MinLot; }
double V_LotMax() { return V_MaxLot; }
double V_LotStep() { return V_StepLot; }
long V_Time() { return V_TimeValue; }
int V_PositionCount() { return V_PositionSize; }
bool V_PositionValid(int i) { if(i<0 || i>=V_PositionSize) { V_Fail("platform.positions","position_unavailable"); return false; } return true; }
double V_PositionVolume(int i) { return V_PositionValid(i) ? V_Positions[i].volume : 0; }
double V_PositionPrice(int i) { return V_PositionValid(i) ? V_Positions[i].price : 0; }
double V_PositionSL(int i) { return V_PositionValid(i) ? V_Positions[i].sl : 0; }
double V_PositionTP(int i) { return V_PositionValid(i) ? V_Positions[i].tp : 0; }
long V_PositionTicket(int i) { return V_PositionValid(i) ? (long)V_Positions[i].ticket : 0; }
bool V_PositionIsBuy(int i) { return V_PositionValid(i) && V_Positions[i].buy; }
int V_TransactionType() { return (int)V_Transaction.type; }
long V_TransactionOrder() { return (long)V_Transaction.order; }
long V_TransactionDeal() { return (long)V_Transaction.deal; }
long V_TransactionPosition() { return (long)V_Transaction.position; }
double V_TransactionVolume() { return V_Transaction.volume; }
double V_TransactionPrice() { return V_Transaction.price; }

bool V_Send(MqlTradeRequest &request,MqlTradeResult &result);
bool V_NativeProcessing(); bool V_NativeOpen(); bool V_NativeReverse(); bool V_NativeClose(); bool V_NativeTrail();
bool V_ClosePosition(int index,double volume) {
 if(V_Fault || !V_PositionValid(index) || volume<=0 || volume>V_Positions[index].volume) return false;
 MqlTradeRequest request={}; MqlTradeResult result={};
 request.action=TRADE_ACTION_DEAL; request.position=V_Positions[index].ticket; request.symbol=_Symbol; request.volume=volume;
 request.type=V_Positions[index].buy ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
 MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) return false; request.price=V_Positions[index].buy ? tick.bid : tick.ask;
 long filling=SymbolInfoInteger(_Symbol,SYMBOL_FILLING_MODE);
 request.type_filling=(filling & SYMBOL_FILLING_FOK)!=0 ? ORDER_FILLING_FOK : (filling & SYMBOL_FILLING_IOC)!=0 ? ORDER_FILLING_IOC : ORDER_FILLING_RETURN;
 return V_Send(request,result); // Sent/accepted is not a confirmed fill.
}
bool V_ProtectPosition(int index,double sl,double tp) {
 if(V_Fault || !V_PositionValid(index)) return false;
 MqlTradeRequest request={}; MqlTradeResult result={}; request.action=TRADE_ACTION_SLTP; request.position=V_Positions[index].ticket;
 request.symbol=_Symbol; request.sl=sl; request.tp=tp; return V_Send(request,result);
}
#endif
