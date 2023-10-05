/**
 * Copyright 2023 Thetis Apps Aps
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * 
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * 
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const axios = require('axios');

/**
 * Send a response to CloudFormation regarding progress in creating resource.
 */
async function sendResponse(input, context, responseStatus, reason) {

	let responseUrl = input.ResponseURL;

	let output = new Object();
	output.Status = responseStatus;
	output.PhysicalResourceId = "StaticFiles";
	output.StackId = input.StackId;
	output.RequestId = input.RequestId;
	output.LogicalResourceId = input.LogicalResourceId;
	output.Reason = reason;
	await axios.put(responseUrl, output);
}


var dataSchema = { type: 'object', properties: {
				"userName": {"type": "string"}, 
				"password": {"type": "string"}}};

exports.initializer = async (input, context) => {
	
	try {
		let ims = await getIMS();
		let requestType = input.RequestType;
		if (requestType == "Create") {
			
			// A default setup to fall back on if no seller specified
			
			let setup = new Object();
			setup.userName = '2080060960';
			setup.password = 'API1234';

			// Create the DF carrier

			let carrier = new Object();
			carrier.carrierName = "DF";
			carrier.dataDocument = JSON.stringify({ DFTransport: setup });
			await ims.post("carriers", carrier);

			// Create a data extension to the seller entity

			let dataExtension = { entityName: 'seller', dataExtensionName: 'DFTransport', dataSchema: JSON.stringify(dataSchema) };
			await ims.post('dataExtensions', dataExtension);
			
		} else if (requestType == 'Update') {
			
			// Update the data extension to the seller entity
			
			let response = await ims.get('dataExtensions');
			let dataExtensions = response.data;
			let found = false;
			let i = 0;
			while (i < dataExtensions.length && !found) {
				let dataExtension = dataExtensions[i];
				if (dataExtension.entityName == 'seller' && dataExtension.dataExtensionName == 'DFTransport') {
					found = true;
				} else {
					i++;
				}
			}
			if (found) {
				let dataExtension = dataExtensions[i];
				await ims.patch('dataExtensions/' + dataExtension.id, { dataSchema: JSON.stringify(dataSchema) });
			} else {
				let dataExtension = { entityName: 'seller', dataExtensionName: 'DFTransport', dataSchema: JSON.stringify(dataSchema) };
				await ims.post('dataExtensions', dataExtension);
			}
			
		}
		
		await sendResponse(input, context, "SUCCESS", "OK");

	} catch (error) {
		await sendResponse(input, context, "SUCCESS", JSON.stringify(error));
	}

};

var cachedIMS = null;

async function getIMS() {
	
	if (cachedIMS == null) {
		
	    const authUrl = "https://auth.thetis-ims.com/oauth2/";
	    const apiUrl = "https://api.thetis-ims.com/2/";
	
		var clientId = process.env.ClientId;   
		var clientSecret = process.env.ClientSecret; 
		var apiKey = process.env.ApiKey;  
		
	    let data = clientId + ":" + clientSecret;
		let base64data = Buffer.from(data, 'UTF-8').toString('base64');	
		
		var imsAuth = axios.create({
				baseURL: authUrl,
				headers: { Authorization: "Basic " + base64data, 'Content-Type': "application/x-www-form-urlencoded" },
				responseType: 'json'
			});
	    
	    var response = await imsAuth.post("token", 'grant_type=client_credentials');
	    var token = response.data.token_type + " " + response.data.access_token;
	    
	    var ims = axios.create({
	    		baseURL: apiUrl,
	    		headers: { "Authorization": token, "x-api-key": apiKey, "Content-Type": "application/json" }
	    	});
		
	
		ims.interceptors.response.use(function (response) {
				console.log("SUCCESS " + JSON.stringify(response.data));
	 	    	return response;
			}, function (error) {
				console.log(JSON.stringify(error));
				if (error.response) {
					console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
				}
		    	return Promise.reject(error);
			});
		
		cachedIMS = ims;
	}
	
	return cachedIMS;
}

var token = null;

async function getDF(sellerSetup) {
    
    const apiUrl = sellerSetup.protocol + "://" + sellerSetup.host + "/api/v3/";
    const authUrl = sellerSetup.protocol + "://" + sellerSetup.host + "/oauth/v2/token";

    if (token == null) {
    	let params = { _format: 'json', client_id: sellerSetup.clientId, client_secret: sellerSetup.clientSecret, grant_type: 'client_credentials' };
        let response = await axios.get(authUrl, { params: params });
        token = "Bearer " + response.data.access_token;
    }
    
    let df = axios.create({
    		baseURL: apiUrl,
            headers: { "Authorization": token, "Content-Type": "application/json" },
        });
        
	df.interceptors.response.use(function (response) {
			console.log("SUCCESS " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});
		
    return df;
}

function lookupCarrier(carriers, carrierName) {
	let i = 0;
    let found = false;
    while (!found && i < carriers.length) {
    	let carrier = carriers[i];
    	if (carrier.carrierName == carrierName) {
    		found = true;
    	} else {
    		i++;
    	}	
    }
    
    if (!found) {
    	throw new Error('No carrier by the name ' + carrierName);
    }

	return carriers[i];
}

exports.bookingHandler = async (event, context) => {

    console.info(JSON.stringify(event));

    var detail = event.detail;

	let ims = await getIMS();

	await ims.patch('/documents/' + detail.documentId, { workStatus: 'ON_GOING' });
	
	let df = await getDF();

	let shipmentId = detail.shipmentId;
	let contextId = detail.contextId;
	
    let response = await ims.get("shipments/" + shipmentId);
    let shipment = response.data;
    
	let seller;
    let setup;
    if (shipment.sellerId != null) {
	    response = await ims.get("sellers/" + shipment.sellerId);
	    seller = response.data;
	    let dataDocument = JSON.parse(seller.dataDocument);
	    setup = dataDocument.DFTransport;
     } else {
	    response = await ims.get("carriers");
	    let carriers = response.data;
	    let carrier = lookupCarrier(carriers, 'DF');
	    let dataDocument = JSON.parse(carrier.dataDocument);
	    setup = dataDocument.DFTransport;
    }
    
    let success = true;
    
    let label = '';
    
    if (success) {
		await ims.post('/documents/' + detail.documentId + '/attachments', label);
		await ims.patch('/documents/' + detail.documentId, { workStatus: 'DONE' });
    } else {
		await ims.patch('/documents/' + detail.documentId, { workStatus: 'FAILED' });
    }
    
	return "done";
	
};

