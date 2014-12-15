/*! h54s v0.0.13 - 2014-12-15 
 *  License: GPL 
 * Author: Boemska 
*/
/*
* Represents html5 for sas adapter
* @constructor
*
*@param {object} config - adapter config object, with keys like url, debug, sasService, etc.
*
*/
h54s = function(config) {

  this.systemtype = "SAS";
  this.counters   =  {
    maxXhrRetries: 5, // this is the number of times that xhrs retry before failing
    finishedXhrCount: 0, // leave as 0
    totalXhrCount: 0 // leave as 0
  };
  this.sasService = 'default';
  this.url        = "/SASStoredProcess/do";
  this.debug      = false;
  this.loginUrl   = '/SASLogon/Logon.do';
  this.sasParams  = [];
  this.autoLogin  = false;


  if(!config) {
    return;
  }

  //merge config argument config
  for(var key in config) {
    if((key === 'url' || key === 'loginUrl') && config[key].charAt(0) !== '/') {
      config[key] = '/' + config[key];
    }
    this[key] = config[key];
  }

  //if server is remote use the full server url
  //NOTE: this is not permited by the same-origin policy
  if(config.hostUrl) {
    if(config.hostUrl.charAt(config.hostUrl.length - 1) === '/') {
      config.hostUrl = config.hostUrl.slice(0, -1);
    }
    this.hostUrl  = config.hostUrl;
    this.url      = config.hostUrl + this.url;
    this.loginUrl = config.hostUrl + this.loginUrl;
  }
};

h54s.Error = function(type, message) {
  Error.captureStackTrace(this);
  this.message = message;
  this.type = type;
};

h54s.Error.prototype = Object.create(Error.prototype);

/*
* Call Sas program
*
* @param {string} sasProgram - Path of the sas program
* @param {function} callback - Callback function called when ajax call is finished
*
*/
h54s.prototype.call = function(sasProgram, callback) {
  var self = this;
  var callArgs = arguments;
  var retryCount = 0;
  if (!callback || typeof callback !== 'function'){
    throw new h54s.Error('argumentError', 'You must provide callback');
  }
  if(!sasProgram) {
    throw new h54s.Error('argumentError', 'You must provide Sas program file path');
  }
  if(typeof sasProgram !== 'string') {
    throw new h54s.Error('argumentError', 'First parameter should be string');
  }

  // initialize dynamically generated xhr options first
  var myprogram;
  if (this.systemtype == 'WPS') {
    myprogram = this.metaProgram + '.sas';
  } else if (this.systemtype == 'SAS') {
    myprogram = this.metaProgram;
  }

  var params = {
    _program: sasProgram,
    _debug: this.debug ? 131 : 0,
    _service: this.sasService,
  };

  for(var key in this.sasParams) {
    params[key] = this.sasParams[key];
  }

  this.utils.ajax.post(this.url, params).success(function(res) {
    if(/<form.+action="Logon.do".+/.test(res.responseText) && self.autoLogin) {
      self.login(function(status) {
        if(status === 200) {
          self.call.apply(self, callArgs);
        } else {
          callback(new h54s.Error('loginError', 'Unable to login'));
        }
      });
    } else if(/<form.+action="Logon.do".+/.test(res.responseText) && !self.autoLogin) {
      callback(new h54s.Error('notLoggedinError', 'You are not logged in'));
    } else {
      var resObj, escapedResObj;
      if(!self.debug) {
        try {
          //clar sas params
          this.sasParams = [];
          resObj = JSON.parse(res.responseText);
          escapedResObj = self.utils.unescapeValues(resObj);
        } catch(e) {
          if(retryCount < self.counters.maxXhrRetries) {
            self.utils.ajax.post(self.url, params).success(this.success).error(this.error);
            retryCount++;
            console.log("Retrying #" + retryCount);
          } else {
            self.utils.parseErrorResponse(res.responseText);
            callback(new h54s.Error('parseError', 'Unable to parse response json'));
          }
        } finally {
          if(resObj) {
            self.utils.addApplicationLogs(resObj);
            callback(undefined, escapedResObj);
          }
        }
      } else {
        try {
          //clear sas params
          this.sasParams = [];
          resObj = self.utils.parseDebugRes(res.responseText);
          escapedResObj = self.utils.unescapeValues(resObj);
        } catch(e) {
          self.utils.parseErrorResponse(res.responseText);
          callback(new h54s.Error('parseError', 'Unable to parse response json'));
        } finally {
          if(resObj) {
            self.utils.addApplicationLogs(resObj);
            callback(undefined, escapedResObj);
          }
        }
      }
    }
  }).error(function(res) {
    callback(new h54s.Error(res.statusText));
  });
};


/*
* Set credentials
*
* @param {string} user - Login username
* @param {string} pass - Login password
*
*/
h54s.prototype.setCredentials = function(user, pass) {
  if(!user || !pass) {
    throw new h54s.Error('credentialsError', 'Missing credentials');
  }
  this.user = user;
  this.pass = pass;
};

/*
* Login method
*
* @param {string} user - Login username
* @param {string} pass - Login password
* @param {function} callback - Callback function called when ajax call is finished
*
* OR
*
* @param {function} callback - Callback function called when ajax call is finished
*
*/
h54s.prototype.login = function(/* (user, pass, callback) | callback */) {
  var callback;
  var self = this;
  if((!this.user && !arguments[0]) || (!this.pass && !arguments[1])) {
    throw new h54s.Error('credentialsError', 'Credentials not set');
  }
  if(typeof arguments[0] === 'string' && typeof arguments[1] === 'string') {
    this.setCredentials(arguments[0], arguments[1]);
    callback = arguments[2];
  } else {
    callback = arguments[0];
  }

  var callCallback = function(status) {
    if(typeof callback === 'function') {
      callback(status);
    }
  };

  this.utils.ajax.post(this.loginUrl, {
    _sasapp: "Stored Process Web App 9.3",
    _service: this.sasService,
    ux: this.user,
    px: this.pass,
  }).success(function(res) {
    if(/<form.+action="Logon.do".+/.test(res.responseText)) {
      callCallback(-1);
    } else {
      //sas can ask for login again in 10 minutes if inactive
      //with autoLogin = true it should login in call method
      self.autoLogin = true;
      callCallback(res.status);
    }
  }).error(function(res) {
    callCallback(res.status);
  });
};

/*
* Add table
*
* @param {object} inTable - Table object
* @param {string} macroName - Sas macro name
*
*/
h54s.prototype.addTable = function (inTable, macroName) {
  var inTableJson = JSON.stringify(inTable);
  inTableJson     = inTableJson.replace(/\"\"/gm, '\" \"');
  inTable         = JSON.parse(inTableJson);

  if (typeof (macroName) !== 'string') {
    throw new h54s.Error('argumentError', 'Second parameter must be a valid string');
  }

  var result;
  try {
    result = this.utils.convertTableObject(inTable);
  } catch(e) {
    throw e;
  }
  var tableArray = [];
  tableArray.push(JSON.stringify(result.spec));
  for (var numberOfTables = 0; numberOfTables < result.data.length; numberOfTables++) {
    var outString = JSON.stringify(result.data[numberOfTables]);
    tableArray.push(outString);
  }
  this.sasParams[macroName] = tableArray;
};

/*
* Get sas errors if there are some
*
*/
h54s.prototype.getSasErrors = function() {
  return this.utils.sasErrors;
};

/*
* Get application logs
*
*/
h54s.prototype.getApplicationLogs = function() {
  return this.utils._logs;
};

h54s.prototype.utils = {};
h54s.prototype.utils._logs = [];
h54s.prototype.utils.ajax = (function () {
  var xhr = function(type, url, data) {
    var methods = {
      success: function() {},
      error: function() {}
    };
    var XHR     = XMLHttpRequest || ActiveXObject;
    var request = new XHR('MSXML2.XMLHTTP.3.0');

    request.open(type, url, true);
    request.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    request.onreadystatechange = function () {
      if (request.readyState === 4) {
        if (request.status >= 200 && request.status < 300) {
          methods.success.call(methods, request);
        } else {
          methods.error.call(methods, request);
        }
      }
    };

    request.send(data);

    return {
      success: function (callback) {
        methods.success = callback;
        return this;
      },
      error: function (callback) {
        methods.error = callback;
        return this;
      }
    };
  };

  var serialize = function(obj) {
    var str = [];
    for(var p in obj)
      if (obj.hasOwnProperty(p)) {
        if(obj[p] instanceof Array) {
          for(var i = 0, n = obj[p].length; i < n; i++) {
            str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p][i]));
          }
        } else {
          str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
        }
      }
    return str.join("&");
  };

  return {
    get: function(url, data) {
      var dataStr;
      if(typeof data === 'object') {
        dataStr = serialize(data);
      }
      var urlWithParams = dataStr ? (url + '?' + dataStr) : '';
      return xhr('GET', urlWithParams);
    },
    post: function(url, data) {
      var dataStr;
      if(typeof data === 'object') {
        dataStr = serialize(data);
      }
      return xhr('POST', url, dataStr);
    }
  };
})();

/*
* Convert table object to Sas readable object
*
* @param {object} inObject - Object to convert
*
*/
h54s.prototype.utils.convertTableObject = function(inObject) {
  var chunkThreshold = 32000; // this goes to 32k for SAS
  // first check that the object is an array
  if (typeof (inObject) !== 'object') {
    throw new h54s.Error('argumentError', 'The parameter passed to checkAndGetTypeObject is not an object');
  }

  var arrayLength = inObject.length;
  if (typeof (arrayLength) !== 'number') {
    throw new h54s.Error('argumentError', 'The parameter passed to checkAndGetTypeObject does not have a valid length and is most likely not an array');
  }

  var existingCols = {}; // this is just to make lookup easier rather than traversing array each time. Will transform after

  // function checkAndSetArray - this will check an inObject current key against the existing typeArray and either return -1 if there
  // is a type mismatch or add an element and update/increment the length if needed

  function checkAndIncrement(colSpec) {
    if (typeof (existingCols[colSpec.colName]) == 'undefined') {
      existingCols[colSpec.colName]           = {};
      existingCols[colSpec.colName].colName   = colSpec.colName;
      existingCols[colSpec.colName].colType   = colSpec.colType;
      existingCols[colSpec.colName].colLength = colSpec.colLength > 0 ? colSpec.colLength : 1;
      return 0; // all ok
    }
    // check type match
    if (existingCols[colSpec.colName].colType !== colSpec.colType) {
      return -1; // there is a fudge in the typing
    }
    if (existingCols[colSpec.colName].colLength < colSpec.colLength) {
      existingCols[colSpec.colName].colLength = colSpec.colLength > 0 ? colSpec.colLength : 1; // increment the max length of this column
      return 0;
    }
  }
  var chunkArrayCount         = 0; // this is for keeping tabs on how long the current array string would be
  var targetArray             = []; // this is the array of target arrays
  var currentTarget           = 0;
  targetArray[currentTarget]  = [];
  var totalChars              = 0;
  var j                       = 0;
  for (var i = 0; i < inObject.length; i++) {
    targetArray[currentTarget][j] = {};
    var chunkRowCount             = 0;

    for (var key in inObject[i]) {
      var thisSpec  = {};
      var thisValue = inObject[i][key];
      // get type... if it is an object then convert it to json and store as a string
      var thisType  = typeof (thisValue);
      if (thisType == 'number') { // straightforward number
        thisSpec.colName                    = key;
        thisSpec.colType                    = 'num';
        thisSpec.colLength                  = 8;
        thisSpec.encodedLength              = thisValue.toString().length;
        targetArray[currentTarget][j][key]  = thisValue;

      }
      if (thisType == 'string') { // straightforward string
        thisSpec.colName    = key;
        thisSpec.colType    = 'string';
        thisSpec.colLength  = thisValue.length;
        if (thisValue === "") {
          targetArray[currentTarget][j][key] = " ";
        } else {
          targetArray[currentTarget][j][key] = escape(thisValue);
        }
        thisSpec.encodedLength = targetArray[currentTarget][j][key].length;
      }
      if (thisType == 'object') { // interesting bit. If it is a date then it will have a toDate
        if (typeof (thisValue.toDateString) !== 'undefined') { // it is a date
          thisSpec.colName                    = key;
          thisSpec.colType                    = 'date';
          thisSpec.colLength                  = 8;
          targetArray[currentTarget][j][key]  = this.formatDate(thisValue, "dd/MM/yyyy");
          thisSpec.encodedLength              = targetArray[currentTarget][j][key].toString().length;
        } else {
          thisSpec.colName                    = key;
          thisSpec.colType                    = 'json';
          thisSpec.colLength                  = JSON.stringify(thisValue).length;
          targetArray[currentTarget][j][key]  = escape(JSON.stringify(thisValue));
          thisSpec.encodedLength              = targetArray[currentTarget][j][key].length;
        }
      }
      chunkRowCount = chunkRowCount +
        6 +
        key.length +
        thisSpec.encodedLength;

      if (checkAndIncrement(thisSpec) == -1) {
        throw new h54s.Error('typeError', 'There is a type mismatch in the array between elements (columns) of the same name.');
      }
    }
    j++;
    // TODO: this needs to go into its own method so that it can be called from the ifs above
    //       rather than doing the postmortem. Needs to abort and start on new array if 32k is
    //       reached.
    if (chunkArrayCount + chunkRowCount > chunkThreshold) {
      targetArray[currentTarget].splice(j - 1, 1); // get rid of that last row
      currentTarget++; // move onto the next array
      targetArray[currentTarget] = []; // make it an array
      i--; // go back to the last row in the source
      j = 0; // initialise new row counter for new array
      chunkArrayCount = 0; // this is the new chunk max size
    } else {
      chunkArrayCount = chunkArrayCount + chunkRowCount;
    }
  }

  // reformat existingCols into an array so sas can parse it;
  var specArray = [];
  for (var k in existingCols) {
    specArray.push(existingCols[k]);
  }
  return {
    spec: specArray,
    data: targetArray,
    jsonLength: chunkArrayCount
  }; // the spec will be the macro[0], with the data split into arrays of macro[1-n]
  // means in terms of dojo xhr object at least they need to go into the same array
};

/*
* Parse response from server in debug mode
*
* @param {object} responseText - response html from the server
*
*/
h54s.prototype.utils.parseDebugRes = function(responseText) {
  //disable jshint for unsafe characters
  /* jshint -W100 */

  //find json
  var patt = /^(﻿--h54s-data-start--)([\S\s]*)(--h54s-data-end--)/m;
  var matches = responseText.match(patt);

  var jsonObj = JSON.parse(matches[2]);

  return jsonObj;
};

//TODO: add support for date
/*
* Unescape all string values in returned object
*
* @param {object} obj
*
*/
h54s.prototype.utils.unescapeValues = function(obj) {
  for (var key in obj) {
    if (typeof obj[key] === 'string') {
      obj[key] = decodeURIComponent(obj[key]);
    } else if(typeof obj === 'object') {
      this.unescapeValues(obj[key]);
    }
  }
  return obj;
};

/*
* Parse error response from server and save errors in memory
*
* @param {string} res - server response
*
*/
h54s.prototype.utils.parseErrorResponse = function(res) {
  patt = /ERROR(.*\.|.*\n.*\.)/g;
  var errors = res.match(patt);
  if(!errors) {
    return;
  }

  for(var i = 0, n = errors.length; i < n; i++) {
    errors[i] = errors[i].replace(/<[^>]*>/g, '').replace(/(\n|\s{2,})/g, ' ');
    errors[i] = this.decodeHTMLEntities(errors[i]);
  }
  this.sasErrors = errors;
};

/*
* Decode HTML entities
*
* @param {string} res - server response
*
*/
h54s.prototype.utils.decodeHTMLEntities = function (html) {
  var tempElement = document.createElement('span');
  var str = html.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,
    function (str) {
      tempElement.innerHTML = str;
      str = tempElement.textContent || tempElement.innerText;
      return str;
    }
  );
  return str;
};

/*
* Adds application logs to an array of logs
*
* @param {string} res - server response
*
*/
h54s.prototype.utils.addApplicationLogs = function(res) {
  if(res.logmessage === 'blank') {
    return;
  }
  this._logs.push(res.logmessage);

  //100 log messages max
  if(this._logs.length > 100) {
    this._logs.shift();
  }
};