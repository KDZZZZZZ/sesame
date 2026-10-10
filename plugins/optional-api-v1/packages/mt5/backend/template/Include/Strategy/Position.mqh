#ifndef STRATEGY_POSITION_MQH
#define STRATEGY_POSITION_MQH
#include <Trade/PositionInfo.mqh>
#include <Expert/ExpertTrade.mqh>
// Agent-owned position phases and exit policy. Reconcile from actual terminal
// positions/deals; a request or signal is not a confirmed position transition.
class CStrategyPosition
  {
public:
   bool Configure() { return false; }
   void Refresh() {}
   void OnTransaction(const MqlTradeTransaction &tx,const MqlTradeRequest &request,const MqlTradeResult &result) {}
   // true: handled this cycle. false: continue native close/trailing processing.
   // Use only the supplied platform-wrapped trade object for requests.
   bool Manage(CPositionInfo *position,CExpertTrade *trade) { return false; }
  };
#endif
