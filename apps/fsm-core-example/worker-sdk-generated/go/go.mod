module pgfsm/async-op-worker-sdk

go 1.19

require fsm-core-example/go-actors-registry-generated v0.0.0
require fsm-core-example/creditcheck/v01/go/actors/checkreportstable v0.0.0

replace fsm-core-example/go-actors-registry-generated => ../../go-actors-registry-generated
replace fsm-core-example/creditcheck/v01/go/actors/checkreportstable => ../../fsm/creditCheck/v01/go/actors/CheckReportsTable
