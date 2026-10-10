#ifndef PRODUCT_SVL_CONFORMANCE_MQH
#define PRODUCT_SVL_CONFORMANCE_MQH
#include <Product/Telemetry.mqh>
// Caller executes its actual translated logic against the frozen input. These
// helpers only preserve observations; they contain no expected result or order API.
void ProductSvlBegin(string fixture_digest,string source_digest,string run_id,string parameters_digest)
  {
   ProductEmit("svl_begin","svl.fixture","{\"fixtureDigest\":"+ProductQuote(fixture_digest)+",\"sourceDigest\":"+ProductQuote(source_digest)+",\"runId\":"+ProductQuote(run_id)+",\"parametersDigest\":"+ProductQuote(parameters_digest)+"}");
  }
void ProductSvlInput(int index,string event_id,string event_digest)
  {
   ProductEmit("svl_input","svl.fixture",StringFormat("{\"index\":%d,\"eventId\":%s,\"digest\":%s}",index,ProductQuote(event_id),ProductQuote(event_digest)));
  }
void ProductSvlEvent(string event_json) { ProductEmit("svl_event","svl.fixture",event_json); }
void ProductSvlEnd(string status,string state_json) { ProductEmit("svl_end","svl.fixture","{\"status\":"+ProductQuote(status)+",\"state\":"+state_json+"}"); }
#endif
