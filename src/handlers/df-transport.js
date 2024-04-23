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

const url = require('url');

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

		} else if (requestType == 'Update') {
			
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
    
    const apiUrl = sellerSetup.url + "/v1/";
    const authUrl = "https://sts.fragt.dk/adfs/oauth2/token";

    if (token == null) {
    	let params = { client_id: sellerSetup.clientId, 
    			Username: 'Fragt\\' + sellerSetup.userName, Password: sellerSetup.password, Resource: sellerSetup.url,
    			grant_type: 'password' };
		params = new url.URLSearchParams(params);
        let response = await axios.post(authUrl, params.toString());
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

/**
 * Check if an object matches a given pattern
 */ 
function patternMatches(object, pattern) {
	let matches = true;
	for (let fieldName in pattern) {
		let fieldValue = pattern[fieldName];
		if (Array.isArray(fieldValue)) {
			if (!pattern[fieldName].includes(object[fieldName])) {
				matches = false;
			}
		} else {
			if (!patternMatches(object[fieldName], pattern[fieldName])) {
				matches = false;
			}
		}
	}
	return matches;
}

/**
 * Find an instruction that matches this shipment.
 */ 
function findInstruction(instructions, shipment) {
	for (let instruction of instructions) {
		if (patternMatches(shipment, instruction.shipmentPattern)) {
			return instruction;
		}
	}
	return null;
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

function createDFAddress(address, contactPerson) {
	return { "Name": address.addressee,
		    "Name2": address.careOf,
		    "Name3": null,
		    "Name4": null,
		    "Street": address.streetNameAndNumber,
		    "Street2": address.floorBlockOrSuite,
		    "Town": address.cityTownOrVillage,
		    "Zipcode": address.postalCode,
		    "Country": address.countryCode,
		    "Phone": null,
		    "Email": null,
		    "ContactPerson": contactPerson.name,
		    "ContactPersonPhone": contactPerson.phoneNumber,
		    "ContactPersonEmail": contactPerson.email };
}

/**
 * Send an event message to Thetis IMS
 */
async function sendEventMessage(ims, detail, text) {
	let message = new Object();
	message.time = Date.now();
	message.source = "PostnordTransport";
	message.messageType = "ERROR";
	message.messageText = text;
	message.deviceName = detail.deviceName;
	message.userId = detail.userId;
	await ims.post("events/" + detail.eventId + "/messages", message);
}

/**
 * Register the handling of this transport booking failed
 */
async function fail(ims, detail, text) {
	await sendEventMessage(ims, detail, text);	
	await ims.patch('/documents/' + detail.documentId, { workStatus: 'FAILED' });
}

exports.bookingHandler = async (event, context) => {

    console.info(JSON.stringify(event));

    var detail = event.detail;

	let ims = await getIMS();

	await ims.patch('/documents/' + detail.documentId, { workStatus: 'ON_GOING' });
	
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
    
	let df = await getDF(setup);

	let attributes = findInstruction(setup.instructions, shipment);

	if (attributes == null) {	
		await fail(ims, detail, "No transport instruction found matching shipment " + shipment.shipmentNumber);
		return null;
	}
    
	let consignment = new Object();
	consignment.AgreementNumber = setup.agreementNumber;
	consignment.Receiver = createDFAddress(shipment.deliveryAddress, shipment.contactPerson);
	consignment.Sender = createDFAddress(seller.address, seller.contactPerson);
	consignment.Initiator = createDFAddress(seller.address, seller.contactPerson);
	
	response = await ims.get('shipments/' + shipment.id + '/globalTradeItemInstances');
	let packedItems = response.data;
	
	let goodsItems = [];
	for (let shippingContainer of shipment.shippingContainers) {

		let goodsType = shippingContainer.platformType == 'EUR_PALLET' ? 'PL1' :
				shippingContainer.platformType == 'HALF_EUR_PALLET' ? 'PL2' :
				shippingContainer.platformType == 'QUARTER_EUR_PALLET' ? 'PL4' : 
				shippingContainer.grossWeight < 20 ? 'K20' : 'CLL';
				
		let goodsItem = {
			    "NumberOfItems": 1,
			    "Type": goodsType,
			    "Weight": Math.ceil(shippingContainer.grossWeight),
			    "Volume": shippingContainer.volume / 1000,
			    "Length": shippingContainer.length,
			    "Width": shippingContainer.width,
			    "Height": shippingContainer.height,
			    "Description": shippingContainer.containerTypeName
	    	};
	
		let dangerousGoods = [];
		for (let packedItem of packedItems) {
			if (packedItem.shippingContainerId == shippingContainer.id) {
				if (packedItem.dangerousGoodsNumber != null) {
					dangerousGoods.push({
						HazardCode: 'H318',
						UNDGnumber: packedItem.dangerousGoodsNumber,
						Weight: packedItem.weight,
						Count: packedItem.instanceCount,
						Packaging: packedItem.productVariantKey.packagingType,
						Unit: 'KG',
						Content: packedItem.productName
					});
				}
			}
		}
	
		goodsItem.DangerousGoods = dangerousGoods;
	
		goodsItems.push(goodsItem);
	}

	consignment.Goods = goodsItems;
	
	consignment.ShippingType = attributes.ShippingType;
	consignment.ConsignmentNoteType = attributes.ConsignmentNoteType;
	consignment.WhoPays = attributes.WhoPays;
	consignment.HubAgreement = attributes.HubAgreement;
	consignment.ProductCode = attributes.ProductCode;
	
	consignment.ShopId = shipment.pickUpPointId;
	
	consignment.ConsignmentDate = new Date();
	
	/* Need to add wave to API Gateway
	
	if (shipment.waveId != null) {
		let now = new Date();
		response = await server.get('waves/' + shipment.waveId);
		let wave = response.data;
		let start = now.toDateString() + ' ' + wave.earliestPickUpTime;
		let end = now.toDateString() + ' ' + wave.latestPickUpTime;
		consignment.PickupTime = { 
				PickupIntervalStart: start, PickupIntervalEnd: end };
	}
	*/

	response = await df.post('Consignments', consignment, { validateStatus: function (status) {
    		    return status >= 200 && status < 300 || status == 400; 
    		}});
	
	if (response.status == 400) {
		
		let fields = response.data;
		
		for (let field in fields) {
			let errors = fields[field];
			let message = new Object();
			message.time = Date.now();
			message.source = "DFTransport";
			message.messageType = "ERROR";
			message.messageText = "Failed to register shipment " + shipment.shipmentNumber + " with DF. DF says: " + JSON.stringify(errors);
			message.deviceName = detail.deviceName;
			message.userId = detail.userId;
			await ims.post("events/" + detail.eventId + "/messages", message);
		}

		await ims.patch('/documents/' + detail.documentId, { workStatus: 'FAILED' });
		
	} else {

		let consignment = response.data;
		
		response = await df.get('Report/GetLabelForPrint', { params: { consignmentNumbers: consignment.ConsignmentNumber }, responseType: 'arraybuffer' });
		let pdf = response.data;
		
		let label = new Object();	
		label.fileName = "SHIPPING_LABEL_" + shipmentId + ".pdf";
		label.base64EncodedContent = pdf.toString('base64');

		await ims.post('/documents/' + detail.documentId + '/attachments', label);
		await ims.patch('/documents/' + detail.documentId, { workStatus: 'DONE' });
		
	}

	return "done";
	
};

