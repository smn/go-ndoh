module.exports = function() {
    return [{
        'request': {
            'method': 'POST',
            'headers': {
                'Content-Type': ['application/xml']
            },
            'url': 'http://test/ws/rest/v1/patients/'
        },
        'response': {
            'body': "<?xml version=\"1.0\" encoding=\"UTF-8\"?><ADT_A05 xmlns=\"urn:hl7-org:v2xml\">   <MSH>      <MSH.1>|</MSH.1>      <MSH.2>^~&amp;</MSH.2>      <MSH.7>         <TS.1>20130819144811</TS.1>      </MSH.7>      <MSH.9>         <MSG.1>ADT</MSG.1>         <MSG.2>A28</MSG.2>         <MSG.3>ADT_A05</MSG.3>      </MSH.9>      <MSH.12>         <VID.1>2.5</VID.1>      </MSH.12>   </MSH>   <PID>      <PID.3>         <CX.1>1234567890ABCDEF</CX.1>         <CX.5>NID</CX.5>      </PID.3>      <PID.5>         <XPN.1>            <FN.1>de Haan</FN.1>         </XPN.1>         <XPN.2>Simon</XPN.2>      </PID.5>      <PID.7>         <TS.1>19800730</TS.1>      </PID.7>      <PID.8>F</PID.8>   </PID>   <NK1>      <NK1.1>1</NK1.1>      <NK1.2>         <XPN.1>            <FN.1></FN.1>         </XPN.1>      </NK1.2>      <NK1.3>         <CE.1>MTH</CE.1>         <CE.2>mother</CE.2>         <CE.3>REL_RTS</CE.3>      </NK1.3>   </NK1>   <NK1>      <NK1.1>2</NK1.1>      <NK1.2>         <XPN.1>            <FN.1></FN.1>         </XPN.1>      </NK1.2>      <NK1.3>         <CE.1>FTH</CE.1>         <CE.2>father</CE.2>         <CE.3>REL_RTS</CE.3>      </NK1.3>   </NK1></ADT_A05>"
        }
    }];
};